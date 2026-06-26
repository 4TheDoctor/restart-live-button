<div align="center">

# 🔄 Restart Ableton Live

**Restart Live without ever leaving Live.**

[![GitHub stars](https://img.shields.io/github/stars/4TheDoctor/restart-ableton-live?style=social)](https://github.com/4TheDoctor/restart-ableton-live/stargazers)
[![Version](https://img.shields.io/badge/version-1.1.0-orange)](https://github.com/4TheDoctor/restart-ableton-live/releases)
[![Ableton Live](https://img.shields.io/badge/Ableton_Live-12_Beta-black)](https://www.ableton.com)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)

<img src="assets/restart-dialog.png" alt="Restart Ableton Live confirmation dialog" width="640" />

</div>

---

## ✨ What it does

Right-click a track, clip, scene, clip slot, or Arrangement selection → **Restart Ableton Live…**

| | |
|---|---|
| 🪟 **One-click confirm** | A clean restart dialog, no terminal, no Activity Monitor |
| 💾 **Safe by default** | Unsaved changes? Live shows its native save dialog first |
| 📂 **Picks up where you left off** | Reopens the current project when possible |
| 🎯 **Version-aware** | Uses the same Live app version that launched the extension |

---

## 📦 Install

1. Download `restart-ableton-live-1.1.0.ablx` from [Releases](https://github.com/4TheDoctor/restart-ableton-live/releases)
2. Open Ableton Live 12 Beta
3. Go to **Preferences → Extensions**
4. Drag the `.ablx` file into the Extensions list
5. Restart Ableton Live when Live asks you to. Yes, seriously.

> Take a breath. Enjoy the ritual. This should be the last time you ever restart Live manually.

Done. Right-click anywhere in Live to use it.

---

## ✅ Requirements

- **Ableton Live 12 Beta** — the Extensions API is currently in beta
- **macOS** — uses AppleScript + `open` to quit and reopen Live
- **Windows** — uses PowerShell + `CloseMainWindow()` to quit and reopen Live

---

## 🛠️ Build from source

```sh
git clone https://github.com/4TheDoctor/restart-ableton-live.git
cd restart-ableton-live
npm install
```

Create `.env` with your Extension Host path:
```
EXTENSION_HOST_PATH=/Applications/Ableton Live 12 Beta.app/Contents/Helpers/ExtensionHost/ExtensionHostNodeModule.node
```

```sh
npm start        # dev mode — loads into Live with hot reload
npm run package  # builds .ablx for distribution
```

---

## ⭐ Star History

<a href="https://www.star-history.com/?type=date&repos=4TheDoctor%2Frestart-ableton-live">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=4TheDoctor/restart-ableton-live&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=4TheDoctor/restart-ableton-live&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=4TheDoctor/restart-ableton-live&type=date&legend=top-left" />
 </picture>
</a>

---

## 📄 License

MIT © [The Doctor](https://github.com/4TheDoctor)
