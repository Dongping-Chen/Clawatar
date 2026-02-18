"""Speaker Service — FastAPI sidecar for voice memory (diarization + embedding)."""

import io
import os
import tempfile
from contextlib import asynccontextmanager
from typing import List, Optional

import numpy as np
import torch
import torchaudio
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Global model holders
# ---------------------------------------------------------------------------
ecapa_model = None
diarization_pipeline = None
models_loaded = False
diarization_available = False


def _load_models():
    """Load ML models at startup."""
    global ecapa_model, diarization_pipeline, models_loaded, diarization_available

    # ECAPA-TDNN for speaker embeddings (always loaded)
    from speechbrain.inference.speaker import EncoderClassifier

    ecapa_model = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"},
    )
    print("[speaker-service] ECAPA-TDNN loaded")

    # Pyannote diarization (optional — needs HF_TOKEN)
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        try:
            from pyannote.audio import Pipeline

            diarization_pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=hf_token,
            )
            diarization_available = True
            print("[speaker-service] pyannote diarization loaded")
        except Exception as exc:
            print(f"[speaker-service] pyannote failed to load: {exc}")
    else:
        print("[speaker-service] HF_TOKEN not set — /diarize disabled")

    models_loaded = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _load_models()
    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Speaker Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".ogg", ".webm", ".m4a", ".flac", ".aac"}


def _load_audio(data: bytes, filename: str) -> torch.Tensor:
    """Load audio bytes, resample to 16 kHz mono, return 1-D tensor."""
    suffix = os.path.splitext(filename or "audio.wav")[1].lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        waveform, sr = torchaudio.load(tmp_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot decode audio: {exc}")
    finally:
        os.unlink(tmp_path)

    # Mono
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    # Resample to 16 kHz
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)

    return waveform.squeeze(0)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CompareRequest(BaseModel):
    embedding_a: List[float]
    embedding_b: List[float]


class CompareResponse(BaseModel):
    similarity: float
    is_match: bool


class EmbedResponse(BaseModel):
    embedding: List[float]
    duration_s: float


class DiarizeSegment(BaseModel):
    speaker: str
    start: float
    end: float


class DiarizeResponse(BaseModel):
    segments: List[DiarizeSegment]


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    diarization_available: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        models_loaded=models_loaded,
        diarization_available=diarization_available,
    )


@app.post("/embed", response_model=EmbedResponse)
async def embed(file: UploadFile = File(...)):
    if ecapa_model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    data = await file.read()
    waveform = _load_audio(data, file.filename)
    duration_s = len(waveform) / 16000.0

    # SpeechBrain expects batch dim
    batch = waveform.unsqueeze(0)
    embedding = ecapa_model.encode_batch(batch).squeeze().detach().cpu().numpy()

    return EmbedResponse(embedding=embedding.tolist(), duration_s=round(duration_s, 3))


@app.post("/compare", response_model=CompareResponse)
async def compare(req: CompareRequest):
    a = np.array(req.embedding_a, dtype=np.float32)
    b = np.array(req.embedding_b, dtype=np.float32)

    if a.shape != b.shape or a.ndim != 1:
        raise HTTPException(status_code=400, detail="Embeddings must be 1-D arrays of equal length")

    cos_sim = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))
    return CompareResponse(similarity=round(cos_sim, 4), is_match=cos_sim >= 0.80)


@app.post("/diarize", response_model=DiarizeResponse)
async def diarize(file: UploadFile = File(...)):
    if diarization_pipeline is None:
        raise HTTPException(
            status_code=503,
            detail="Diarization not available. Set HF_TOKEN and accept pyannote model terms.",
        )

    data = await file.read()
    suffix = os.path.splitext(file.filename or "audio.wav")[1].lower()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        result = diarization_pipeline(tmp_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Diarization failed: {exc}")
    finally:
        os.unlink(tmp_path)

    segments = []
    for turn, _, speaker in result.itertracks(yield_label=True):
        segments.append(DiarizeSegment(speaker=speaker, start=round(turn.start, 3), end=round(turn.end, 3)))

    return DiarizeResponse(segments=segments)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5050)
