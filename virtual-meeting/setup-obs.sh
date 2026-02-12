#!/bin/bash
# OBS Scene Setup for Clawatar Virtual Meeting
#
# This script creates an OBS scene profile that captures the VRM viewer browser window.
# Run this ONCE to set up OBS, then just launch OBS and click "Start Virtual Camera".

echo "=== Clawatar OBS Setup ==="
echo ""

# Check OBS is installed
if ! command -v obs &> /dev/null; then
    echo "ERROR: OBS Studio not found. Install with:"
    echo "  brew install --cask obs"
    exit 1
fi

# Check BlackHole
if ! ls /Library/Audio/Plug-Ins/HAL/ 2>/dev/null | grep -q BlackHole; then
    echo "WARNING: BlackHole audio device not detected."
    echo "Install with: brew install --cask blackhole-2ch"
    echo "Then REBOOT your Mac."
    echo ""
    echo "After reboot, set up Audio MIDI Setup:"
    echo "  1. Open Audio MIDI Setup (Spotlight → 'Audio MIDI Setup')"
    echo "  2. Click + → Create Multi-Output Device"
    echo "     - Check: Built-in Output (your speakers/headphones)"
    echo "     - Check: BlackHole 2ch"
    echo "  3. Set System Output → Multi-Output Device"
    echo ""
fi

echo "OBS is installed at: $(which obs)"
echo ""
echo "Manual OBS setup steps:"
echo "  1. Open OBS Studio"
echo "  2. Sources → + → Window Capture → select browser at localhost:3000"
echo "  3. Right-click source → Transform → Fit to Screen"
echo "  4. Tools → Start Virtual Camera"
echo "  5. In your meeting app, select 'OBS Virtual Camera' as camera"
echo ""
echo "For audio:"
echo "  - Meeting app microphone → BlackHole 2ch"
echo "  - Meeting app speaker → Multi-Output Device (so you hear + BlackHole captures)"
echo ""
echo "Then run: npm run meeting"
echo "  This captures meeting audio → transcribes → sends to AI → avatar responds"
echo ""
echo "=== Setup complete ==="
