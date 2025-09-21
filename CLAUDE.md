# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KoolerTawk is a spatial audio chat application built with Next.js 15 and PartyKit. Users can join virtual rooms, select seats, and communicate with others using proximity-based spatial audio. The project features:
- Next.js 15 with App Router and Turbopack
- TypeScript with strict configuration
- Tailwind CSS v4 for styling
- PartyKit for real-time websocket server functionality
- WebRTC for peer-to-peer audio communication
- Spatial audio with volume based on distance between users

## Development Commands

```bash
# Start development server with Turbopack
npm run dev

# Build for production with Turbopack
npm run build

# Start production server
npm start

# Run linting
npm run lint
```

## Architecture

### Frontend (Next.js)
- **Location**: `src/app/`
- **Entry point**: `src/app/page.tsx`
- **Layout**: `src/app/layout.tsx` with Geist fonts configured
- **Styling**: Tailwind CSS v4 with CSS variables for theming in `src/app/globals.css`
- **Path aliases**: `@/*` maps to `./src/*`

### Real-time Server (PartyKit)
- **Location**: `party/index.ts`
- **Configuration**: `partykit.json` with main entry point
- **Functionality**: Spatial audio server that manages:
  - 4x4 grid of seats with position coordinates
  - User seat assignments and movement
  - Proximity-based communication (200px hearing range)
  - WebRTC signaling for peer-to-peer audio
  - Spatial chat messages only sent to users within range

### Key Dependencies
- `partysocket`: Client-side websocket library for connecting to PartyKit
- `react 19.1.0` and `react-dom 19.1.0`: Latest React versions
- `next 15.5.3`: Latest Next.js with App Router

## Configuration Files

- **TypeScript**: `tsconfig.json` with ES2017 target and bundler module resolution
- **ESLint**: `eslint.config.mjs` extends Next.js core-web-vitals and TypeScript rules
- **Next.js**: `next.config.ts` with default configuration
- **PostCSS**: `postcss.config.mjs` for Tailwind CSS processing

## Development Notes

- The project uses Turbopack for faster builds and development
- PartyKit server needs to be deployed separately from the Next.js app
- Websocket connections are handled through the PartyKit server at `party/index.ts`
- The application supports dark mode through CSS custom properties and `prefers-color-scheme`

## Spatial Audio Features

### Core Components
- **SpatialAudioChat**: Main component at `src/app/components/SpatialAudioChat.tsx`
- **Seat Selection**: Users choose from a 4x4 grid of seats before joining
- **Real-time Room Visualization**: Visual representation of all users and their positions
- **Proximity Chat**: Text and audio chat limited to users within 200px range

### Audio System
- **WebRTC**: Peer-to-peer audio connections between users
- **Spatial Processing**: Volume calculation based on distance using inverse square law
- **Web Audio API**: Gain nodes for spatial audio volume control
- **Microphone Access**: Requests user permission for audio input

### Server Architecture
- **Seat Management**: Tracks seat occupancy and user positions
- **Distance Calculation**: Server-side proximity detection for chat/audio routing
- **WebRTC Signaling**: Facilitates peer connection establishment
- **State Broadcasting**: Real-time room state updates to all connected clients

### Usage Flow
1. User enters name and selects available seat
2. Microphone permission requested and WebRTC connections established
3. Audio volume automatically adjusts based on proximity to other users
4. Users can move between available seats
5. Chat messages only visible to users within hearing range