# Opens a free public tunnel to your locally running ATB server.
# Requires cloudflared (one-time install):  winget install Cloudflare.cloudflared
# Then just run:  .\share.ps1   (while `npm start` is running in another window)
# It prints a https://xxxx.trycloudflare.com URL — send that to your friends.
# The link works as long as this window and the server stay open.

$port = 3000
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "Nothing is running on port $port. Start the app first:  npm start" -ForegroundColor Yellow
  exit 1
}
cloudflared tunnel --url "http://localhost:$port"
