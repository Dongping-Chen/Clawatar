# Speaker Service

Python sidecar for voice memory — speaker diarization + embedding.

## Setup

```bash
pip install -r requirements.txt
```

## HuggingFace Token (for pyannote)

pyannote/speaker-diarization-3.1 requires accepting the model terms at huggingface.co and setting a token:

```bash
export HF_TOKEN=your_token_here
```

1. Go to https://huggingface.co/pyannote/speaker-diarization-3.1 and accept terms
2. Go to https://huggingface.co/pyannote/segmentation-3.0 and accept terms
3. Create a token at https://huggingface.co/settings/tokens

Without HF_TOKEN, the /diarize endpoint will return 503. /embed and /compare work without it.

## Run

```bash
python speaker_service.py
# Listens on http://localhost:5050
```

Models (~1GB total) are downloaded on first run.

## Endpoints

- **POST /embed** — extract 192-dim speaker embedding from audio file
- **POST /compare** — cosine similarity between two embeddings
- **POST /diarize** — speaker diarization (who spoke when)
- **GET /health** — health check
