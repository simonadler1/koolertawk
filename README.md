# KoolerTawk - Spatial Audio Chat

A real-time spatial audio chat application built with Next.js 15 and PartyKit. Users can join virtual rooms, select seats, and communicate using proximity-based spatial audio with 3D positioning.

## Features

- **🎧 3D Spatial Audio**: HRTF-based stereo positioning with distance-based volume
- **🗺️ Interactive Seat Map**: 4x4 grid of seats with visual position indicators
- **⚡ Real-time Communication**: WebRTC peer-to-peer audio with PartyKit signaling
- **🔊 Proximity Chat**: Audio and text messages limited to users within hearing range
- **🎤 Audio Testing Tools**: Built-in microphone and speaker testing
- **📱 Responsive Design**: Works on desktop and mobile devices

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open [http://localhost:3000](http://localhost:3000) to access the application.

## Audio Architecture

### Stable Audio Pipeline ⚠️ CRITICAL
The application uses a **muted HTMLAudioElement + Web Audio pipeline** to ensure reliable playback and avoid "stream already in use" crashes:

```
Remote MediaStream → HTMLAudioElement (muted) → Web Audio Graph → Speakers
                                                     ↓
                                   MediaElementSource → PannerNode → GainNode → Destination
```

**Key Implementation Details:**
- **HTMLAudioElement**: Set `srcObject`, `muted=true`, `volume=1.0`, then call `.play()`
- **MediaElementSource**: Created from audio element (NOT directly from MediaStream)
- **Immediate Kickstart**: `updateSpatialAudio()` called right after node wiring
- **No Silent Periods**: Audio flows immediately with proper gain values

**⚠️ Do NOT change this to direct MediaStreamSource - it will cause browser crashes!**

### Spatial Audio Features
- **Distance-Based Volume**: Closer users sound louder (inverse square law)
- **Stereo Positioning**: Users positioned left/right/front/back in stereo field
- **Hearing Range**: 80% room distance maximum, with multiple volume zones
- **Optimistic Updates**: Position changes update audio immediately

## Technology Stack

- **Frontend**: Next.js 15 with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4 with CSS custom properties
- **Real-time**: PartyKit for WebSocket server and signaling
- **Audio**: Web Audio API with WebRTC for peer-to-peer communication
- **Build**: Turbopack for fast development and builds

## Development

### Project Structure
```
src/app/                 # Next.js App Router
├── components/          # React components
│   └── SpatialAudioChat.tsx  # Main audio chat component
├── globals.css          # Tailwind CSS styles
└── page.tsx            # Home page

party/
└── index.ts            # PartyKit server for real-time features

TESTING.md              # Comprehensive testing guide
CLAUDE.md               # Development guidance
```

### Key Commands
```bash
npm run dev             # Development with Turbopack
npm run build           # Production build
npm run lint            # ESLint checking
```

### Testing
See [TESTING.md](./TESTING.md) for comprehensive manual testing scenarios, console debugging guides, and regression tests.

## Deployment

### Environment Variables
```bash
NEXT_PUBLIC_PARTYKIT_URL=your-party.username.partykit.dev
```

### Cloudflare Pages
The Next.js app deploys to Cloudflare Pages with proper environment variable configuration.

### PartyKit Server
Deploy the real-time server separately:
```bash
npx partykit deploy
```

## Browser Compatibility

- **Chrome/Chromium**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: WebRTC limitations may affect some features
- **Mobile**: Works on iOS Safari and Android Chrome

## Architecture Notes

This project implements a sophisticated audio pipeline to handle the complexities of WebRTC streams and Web Audio API. Future enhancements should preserve the muted HTMLAudioElement approach to maintain stability across browsers.

## License

MIT License
