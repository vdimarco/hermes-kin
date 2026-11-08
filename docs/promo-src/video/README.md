# Demo video sources

`comp.html` is the whole 60-second timeline. The overlay scenes run the real
`overlay/index.html` in an iframe; `mock.js` stands in for the Electron bridge
(`window.kinFloat`) and feeds it sample tasks, moods, and mic levels.

`capture.js` steps a fake clock one frame at a time, so the 3D busts, the 2D
engine, and CSS animations render frame-exact. Needs Node, Playwright's
Chromium, and ffmpeg.

```bash
node capture.js frames 30 60                              # landscape, 1920x1080
VW=1080 VH=1920 QS='?v=1' node capture.js vframes 30 60   # vertical, 1080x1920
ffmpeg -framerate 30 -i frames/%05d.jpg -i music.m4a -map 0:v -map 1:a \
  -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart demo.mp4
```

The music track is not in the repo; any 60-second track works.
