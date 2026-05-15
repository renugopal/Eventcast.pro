# 🧠 Knowledge Item: Media Server Infrastructure (Datarhei Core)

This document provides technical details about the streaming infrastructure of Eventcast Pro.

## 📡 Media Server Details
- **Base URL**: `https://media.eventcast.pro`
- **Software**: Datarhei Core (Restreamer API V3)
- **Ingest Protocol**: RTMP
- **Ingest Path**: `rtmp://34.100.142.25/{slug}`
- **Stream Key**: `live`

## 📽️ HLS / VOD Configuration (Updated May 14, 2026)
To support full event recording (Live-to-VOD), the following FFmpeg output settings are applied:
- **Format**: `hls`
- **Segment Time**: `4s`
- **Playlist Size**: `0` (Unlimited, keeps all segments)
- **Playlist Type**: `event` (Maintains history for replay)
- **Deletion**: Disabled (`delete_segments` flag removed)
- **Storage Path**: `{memfs}`

## 🔀 YouTube Relay Logic
- **Forwarding Path**: `rtmp://a.rtmp.youtube.com/live2/{youtube_stream_key}`
- **Independent Control**: Managed via `/api/media/toggle-youtube` which adds/removes the `youtube` output from the Datarhei process without stopping HLS.
