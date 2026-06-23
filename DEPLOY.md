# Deploying This Website

This app needs a Node host because `server.js` provides `/api/translate`.

## Easiest Option: Render

1. Put this folder in a GitHub repository.
2. Go to Render and create a new **Web Service** from that repository.
3. Use these settings:
   - Runtime: `Node`
   - Build command: leave blank, or use `npm install`
   - Start command: `npm start`
4. Deploy it.

Render provides the `PORT` environment variable automatically. The app now listens on `0.0.0.0`, which lets the cloud host route web traffic to it.

## Other Node Hosts

This should also work on services such as Railway, Fly.io, or a VPS as long as they can run:

```powershell
npm start
```

The host must expose the app's assigned `PORT`.
