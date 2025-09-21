# KoolerTawk Testing Guide

## Manual QA Steps

### Audio Connection Testing
1. **Join with two clients**
   - Open two browser windows/tabs
   - Join with different names
   - Select seats close to each other (< 30% distance)
   - Verify both users can hear each other

2. **Distance-Based Volume Testing**
   - Move one user to adjacent seats
   - Check console logs for gain updates: `🎧 User X: distance=Y%, gain=Z, position=(x, y, z)`
   - Verify audible volume matches distance:
     - Close (≤15%): Full volume (gain ~1.0)
     - Medium (15-50%): Reduced volume (gain 0.4-0.8)
     - Far (50-80%): Low volume (gain 0-0.4)
     - Very far (>80%): No audio (gain 0)

3. **Stereo Positioning Testing** ⭐ NEW
   - **Requirements**: Use stereo headphones or speakers
   - **Test Scenarios**:
     - **Left/Right**: Place User B to the left/right of User A
       - User B should sound primarily in left/right ear
       - Check console: `position=(-X, 0, Z)` for left, `position=(+X, 0, Z)` for right
     - **Front/Back**: Place User B in front/behind User A
       - User B should sound centered but with subtle depth cues
       - Check console: `position=(0, 0, -Z)` for front, `position=(0, 0, +Z)` for back
     - **Diagonal Movement**: Move User B in circles around User A
       - Audio should smoothly pan around the stereo field
       - Position coordinates should change continuously

4. **Seat Movement Testing**
   - Click empty seats to move
   - Verify hearing circle moves immediately (optimistic update)
   - Check position coordinates update in development mode
   - Confirm server state sync in console logs

5. **Mute/Unmute Testing**
   - Toggle audio off/on multiple times
   - Verify connections rebuild after unmute
   - Check console for: `🔄 Re-enabling audio, creating new offers`

### Console Log Checkpoints
Look for these key log messages:

#### Connection Establishment ✅ SIMPLIFIED
- `📤 Local stream details for X` - local audio tracks added
- `🎵 Received remote audio track from X` - remote audio received
- `✅ Audio element playing for X` - HTML audio element ready
- `🔊 Basic audio graph connected for X: HTMLAudioElement -> MediaElementSource -> GainNode -> Destination`
- `🎯 Set initial gain for X: Y` - distance-based volume set
- `🔄 Triggering spatial audio update after connecting X` - immediate gain update

#### Spatial Audio Updates ✅ SIMPLIFIED
- `🔊 Updating spatial audio for X connections`
- `🔊 User X: distance=Y%, gain=Z (gain only)` - simple distance-based volume

#### Movement ✅ SIMPLIFIED
- `🚶 Moving from seat-X to seat-Y`
- Room state updates from server (no optimistic updates)

#### Audio State Changes
- `🎤 Audio enabled/disabled`
- `🔄 Re-enabling audio, creating new offers to existing users`

### Regression Scenarios

#### Scenario 1: Basic Connection ✅ BACK TO BASICS
1. User A joins seat-0-0 (top-left)
2. User B joins seat-0-1 (adjacent right)
3. **Expected**:
   - Both hear each other at high volume (gain ~0.8-1.0)
   - **No "Error setting up audio" logs**
   - Audio starts immediately (no silent period)
   - Console shows: `✅ Audio element playing for X`
   - Console shows: `🔊 Basic audio graph connected`
   - Console shows: `🔄 Triggering spatial audio update`

#### Scenario 2: Distance-Based Volume
1. User A at seat-0-0, User B at seat-0-1 (close)
2. User B moves to seat-3-3 (far corner)
3. **Expected**: Volume drops significantly or goes silent
4. User B moves to seat-1-1 (medium distance)
5. **Expected**: Volume returns at medium level

#### Scenario 3: Mute/Unmute Cycle ✅ UPDATED
1. Both users connected and talking
2. User A mutes, then unmutes
3. **Expected**:
   - Audio connection restored, both can hear again
   - **Audio flows immediately after unmute (no delay)**
   - Spatial positioning correct from first moment

#### Scenario 4: Multiple Movements
1. User A moves rapidly between several seats
2. **Expected**: Hearing circle follows smoothly, volume updates correctly
3. Other users see position updates in real-time

#### Scenario 5: Error Recovery ✅ UPDATED
1. Simulate network issues (disconnect/reconnect)
2. **Expected**: Detailed error logs with error name and message
3. Console shows: `🔍 ERROR DETAILS: Name: X, Message: Y`
4. Console shows: `🧹 Cleaning up failed connection`
5. Console shows: `⚠️ Audio setup failed for X, but continuing operation`
6. Verify no connection leaks or retry loops

#### Scenario 6: Manual Test Harness ✅ NEW
Open browser console and run:
```javascript
// Check that audioElement.play() resolves
audioConnectionsRef.current.forEach((conn, userId) => {
  console.log(`${userId}: audioElement.play resolves =`, !conn.audioElement.paused);
  console.log(`${userId}: has gainNode =`, !!conn.gainNode);
  console.log(`${userId}: has pannerNode =`, !!conn.pannerNode);
});
```

### Development Tools

#### Console Commands
```javascript
// Check current connections
audioConnectionsRef.current

// Manually trigger spatial audio update
updateSpatialAudio()

// Check current user position
currentUser.position

// Check all users and positions
roomState.users.map(u => ({ name: u.name, position: u.position }))
```

#### Visual Indicators (Development Mode Only)
- Blue coordinate labels show exact position
- Hearing circle animates on movement
- Console logs show detailed state changes

### Browser Compatibility
Test on:
- Chrome/Chromium (recommended)
- Firefox
- Safari (may have WebRTC limitations)

## Architecture Notes

### Audio Path Design ✅ UPDATED
The application uses a **muted HTMLAudioElement + Web Audio pipeline** to avoid "stream already in use" crashes:

```
Remote MediaStream → HTMLAudioElement (muted, playing) → Web Audio Graph → Speakers
                                                              ↓
                                            MediaElementSource → PannerNode → GainNode → Destination
```

**Critical Implementation Details:**
- **HTMLAudioElement**: Set `srcObject`, `muted=true`, `volume=1.0`, then call `.play()`
- **MediaElementSource**: Created from the audio element (NOT directly from MediaStream)
- **No Direct MediaStream**: Avoids browser "already in use" errors
- **Immediate Kickstart**: `updateSpatialAudio()` called right after node creation
- **HRTF Positioning**: PannerNode provides true 3D stereo positioning
- **Distance Attenuation**: GainNode controls volume based on seat distance

**Why this approach works:**
- **Stream Stability**: HTMLAudioElement handles WebRTC stream lifecycle
- **No Duplicate Audio**: Muted element prevents double output
- **Immediate Audio**: No silent periods or gain=0 race conditions
- **Error Resilience**: Comprehensive error logging and cleanup
- **Cross-Browser**: Compatible with all major browsers

### Error Prevention ✅ UPDATED
- **Duplicate Stream Protection**: Checks existing srcObject to prevent multiple setups
- **Immediate Spatial Kickstart**: `updateSpatialAudio()` called right after node wiring
- **Comprehensive Error Logging**: Surfaces error.name, error.message, and full state
- **Graceful Failure**: Continues operation even if individual connections fail
- **Resource Cleanup**: Proper disposal of failed audio elements and peer connections

### Known Issues
- First connection may require user gesture for audio autoplay
- Safari requires additional WebRTC permissions
- Audio may not work in private/incognito mode on some browsers
- Deprecated Web Audio methods (browser compatibility fallbacks)