/*
 * Lấy GOOGLE_OAUTH_REFRESH_TOKEN cho Google Drive (chạy MỘT lần).
 *
 * Chuẩn bị (Google Cloud Console, cùng project với Drive API đã bật):
 *   1. APIs & Services → Credentials → Create Credentials → OAuth client ID.
 *   2. Application type: "Desktop app". Tạo xong copy Client ID + Client secret.
 *   3. Bật "Google Drive API" cho project.
 *   4. Màn OAuth consent screen: thêm chính email của bạn vào "Test users".
 *   5. Điền vào .env:
 *        GOOGLE_OAUTH_CLIENT_ID=...
 *        GOOGLE_OAUTH_CLIENT_SECRET=...
 *
 * Chạy:  node scripts/get-drive-token.js
 *   → mở URL hiện ra, đăng nhập tài khoản sẽ sở hữu ảnh, đồng ý.
 *   → script in ra GOOGLE_OAUTH_REFRESH_TOKEN, copy vào .env.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Đọc .env tối giản (không cần dotenv).
function readEnv() {
  const p = path.resolve(process.cwd(), '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv();
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    'Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET trong .env',
  );
  process.exit(1);
}

const PORT = 8888;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
// drive.file: chỉ truy cập các file do app này tạo — đủ để upload + chia sẻ.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // ép trả refresh_token mỗi lần
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('Lấy token thành công! Quay lại terminal, có thể đóng tab này.');
    if (tokens.refresh_token) {
      console.log('\n=== Thêm dòng sau vào .env ===\n');
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    } else {
      console.error(
        '\nKhông nhận được refresh_token. Thử thu hồi quyền cũ tại ' +
          'https://myaccount.google.com/permissions rồi chạy lại.',
      );
    }
  } catch (e) {
    res.end('Lỗi đổi token, xem terminal.');
    console.error('Lỗi đổi token:', e.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Mở URL sau trong trình duyệt để cấp quyền:\n');
  console.log(authUrl + '\n');
});
