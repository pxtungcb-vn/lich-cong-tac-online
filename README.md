# Lịch công tác online — Thường trực Tỉnh uỷ Cao Bằng

Ứng dụng web gồm 2 trang:

- **`index.html`** — Trang xem lịch công tác, **công khai cho mọi người**, tự động cập nhật ngay khi có thay đổi (không cần tải lại trang), hiển thị đẹp trên cả máy tính và điện thoại.
- **`admin.html`** — Trang nhập/sửa lịch công tác, **chỉ dành cho người có trách nhiệm** (Lãnh đạo Văn phòng Tỉnh uỷ hoặc Thư ký), yêu cầu đăng nhập.

Dữ liệu được lưu trên **Firebase** (dịch vụ máy chủ miễn phí của Google) — đây là lý do trang xem lịch cập nhật theo thời gian thực. Mã nguồn giao diện được đăng công khai trên **GitHub Pages**.

> Chi phí: với quy mô dùng nội bộ (vài người nhập liệu, vài trăm/nghìn lượt xem mỗi tháng), gói **miễn phí (Spark)** của Firebase là quá đủ, không tốn phí.

---

## PHẦN A — Thiết lập Firebase (làm 1 lần)

### Bước 1: Tạo project Firebase

1. Vào https://console.firebase.google.com, đăng nhập bằng tài khoản Google của anh.
2. Bấm **"Add project" / "Thêm dự án"**.
3. Đặt tên, ví dụ: `lich-cong-tac-caobang` → Continue.
4. Tắt Google Analytics (không cần dùng) → **Create project**.

### Bước 2: Tạo Firestore Database (nơi lưu dữ liệu)

1. Trong menu bên trái, chọn **Build > Firestore Database**.
2. Bấm **Create database**.
3. Chọn khu vực gần Việt Nam, ví dụ `asia-southeast1 (Singapore)`.
4. Chọn **Start in production mode** → Enable.
5. Vào tab **Rules**, xoá hết nội dung mẫu, dán toàn bộ nội dung file **`firestore.rules`** (đi kèm trong bộ mã nguồn này) vào, rồi bấm **Publish**.

### Bước 3: Bật đăng nhập bằng Email/Password

1. Menu bên trái: **Build > Authentication** → **Get started**.
2. Tab **Sign-in method** → chọn **Email/Password** → **Enable** → **Save**.
3. Qua tab **Users** → **Add user** → tạo **một tài khoản đầu tiên** (của anh) để đăng nhập vào trang nhập liệu.
   - *Lưu ý:* từ tài khoản đầu tiên này trở đi, **không cần vào lại Firebase Console nữa** — mọi tài khoản tiếp theo được thêm ngay trong trang nhập liệu (xem mục "Quản lý tài khoản đăng nhập" ở Phần C).
4. Trong Firestore Database (Bước 2), vào collection `accounts`, tạo 1 document với ID đúng bằng **UID** của tài khoản vừa tạo (xem UID ở tab Users), gồm các trường: `email` (string), `displayName` (string, họ tên), `position` (string, chức vụ), `role` = `"superadmin"` (string), `disabled` = `false` (boolean). Đây là tài khoản quản trị cấp cao duy nhất có quyền vô hiệu hóa tài khoản khác.

### Bước 4: Lấy thông tin cấu hình (config) để dán vào mã nguồn

1. Bấm icon **⚙️ (Project settings)** ở góc trên trái.
2. Kéo xuống phần **Your apps**, bấm icon **`</>`** (Web) để tạo một Web app.
3. Đặt tên (ví dụ "Lich cong tac web") → **Register app** (không cần Firebase Hosting).
4. Firebase sẽ hiện một đoạn mã `firebaseConfig = { apiKey: ..., authDomain: ..., ... }`.
5. Mở file **`firebase-config.js`** trong bộ mã nguồn, thay các giá trị `DIEN_API_KEY_CUA_BAN`, `TEN_PROJECT`, ... bằng đúng giá trị Firebase vừa cho. Lưu file lại.

> Các giá trị này **không phải thông tin bí mật** — để công khai trên GitHub là an toàn, vì quyền truy cập thực sự do Firestore Rules (Bước 2.5) và Authentication (Bước 3) kiểm soát, không phải do giấu config.

---

## PHẦN B — Đăng mã nguồn lên GitHub (GitHub Pages)

Claude sẽ hỗ trợ bước này trực tiếp (tạo repository, đẩy mã nguồn, bật GitHub Pages) sau khi anh kết nối tài khoản GitHub với Claude trong **Settings → Connectors** của claude.ai.

Nếu anh muốn tự làm:

1. Vào https://github.com/new, tạo repository mới, ví dụ `lich-cong-tac-online`, để **Public**.
2. Tải toàn bộ các file trong bộ mã nguồn này lên (dùng "Add file > Upload files" trên GitHub, hoặc Git nếu quen dùng).
3. Vào **Settings > Pages** của repository → ở "Build and deployment", chọn **Source: Deploy from a branch**, Branch: `main`, folder `/ (root)` → **Save**.
4. Sau 1–2 phút, GitHub sẽ cấp một địa chỉ dạng:
   `https://<ten-tai-khoan-github>.github.io/lich-cong-tac-online/`
   Đây là địa chỉ **trang xem lịch công tác công khai** để chia sẻ cho mọi người.
   Trang nhập liệu nằm tại: `.../lich-cong-tac-online/admin.html`

---

## PHẦN C — Sử dụng hằng ngày

### Người xem lịch (tất cả mọi người)

- Mở địa chỉ trang web (được cấp ở Phần B, bước 4) trên máy tính hoặc điện thoại.
- Không cần đăng nhập. Lịch hiển thị tuần hiện tại; có thể bấm "Tuần trước / Tuần sau" để xem tuần khác.
- Khi người nhập liệu lưu thay đổi, trang này **tự cập nhật ngay**, không cần bấm tải lại.

### Người nhập liệu (Lãnh đạo Văn phòng / Thư ký)

1. Mở `admin.html`, đăng nhập bằng email/mật khẩu đã được cấp (Phần A, Bước 3, hoặc được thêm sau này ngay trong trang — xem mục dưới).
2. Chọn đúng tuần cần nhập (dùng nút "Tuần trước / Tuần sau / Về tuần này").
3. Gõ nội dung công tác buổi Sáng / Chiều cho từng người trong Thường trực Tỉnh uỷ, ở từng ngày.
   - Có thể bấm **"Sao chép nội dung từ tuần trước"** nếu tuần mới có nhiều nội dung lặp lại (ví dụ "Làm việc tại cơ quan"), sau đó chỉ cần sửa những phần khác.
4. Bấm **"💾 Lưu lịch công tác tuần này"**. Mọi người xem lịch sẽ thấy thay đổi ngay lập tức.
5. Nếu có thay đổi 4 chức danh Thường trực Tỉnh uỷ (do nhân sự thay đổi), bấm **"Sửa danh sách 4 chức danh"** để cập nhật tên/chức vụ — áp dụng cho mọi tuần.

### Quản lý tài khoản đăng nhập (mới)

Ngay trong trang nhập liệu có mục **"Quản lý tài khoản đăng nhập"** để không phải vào Firebase Console nữa:

- **Thêm tài khoản mới:** bất kỳ ai đã đăng nhập (có quyền cập nhật dữ liệu) đều bấm được "+ Thêm tài khoản" — bắt buộc nhập **Họ và tên**, **Chức vụ**, Email, Mật khẩu cho người được cấp tài khoản. Thông tin này hiển thị cùng tài khoản trong danh sách, để biết tài khoản nào là của ai.
- **Vô hiệu hóa tài khoản:** chỉ tài khoản quản trị cấp cao (superadmin — ban đầu là tài khoản tạo ở Bước 3) mới thấy nút này và mới dùng được. Tài khoản bị vô hiệu hóa sẽ không đăng nhập/cập nhật được lịch nữa, nhưng vẫn hiện trong danh sách (có thể kích hoạt lại).
- **Lưu ý quan trọng:** vì lý do kỹ thuật (Firebase ở gói miễn phí không cho phép xoá hẳn tài khoản đăng nhập từ phía trình duyệt), "xoá tài khoản" ở đây thực chất là **vô hiệu hóa** — tài khoản mất quyền truy cập ngay lập tức, nhưng bản ghi đăng nhập gốc vẫn còn trong hệ thống Firebase (không ai dùng được). Nếu cần xoá hẳn vĩnh viễn, phải vào Firebase Console > Authentication > Users để xoá thủ công.

---

## Cấu trúc file trong bộ mã nguồn

| File | Vai trò |
|---|---|
| `index.html`, `display.js` | Trang xem lịch công tác công khai |
| `admin.html`, `admin.js`, `admin.css` | Trang đăng nhập & nhập liệu, gồm cả quản lý tài khoản |
| `style.css` | Giao diện chung (dùng chung cho cả 2 trang) |
| `shared.js` | Hàm tính tuần/ngày, kết nối Firebase |
| `firebase-config.js` | **Cần điền thông tin Firebase của anh vào đây** (Phần A, Bước 4) |
| `firestore.rules` | Quy tắc phân quyền đọc/ghi dữ liệu — dán vào Firebase Console (Phần A, Bước 2.5), gồm cả phân quyền cho collection `accounts` |

## Xử lý một số tình huống thường gặp

- **Trang xem lịch báo "Không thể tải dữ liệu..."**: kiểm tra lại đã điền đúng `firebase-config.js` chưa, và đã **Publish** Firestore Rules chưa.
- **Đăng nhập trang nhập liệu báo lỗi**: kiểm tra email/mật khẩu đã được tạo đúng trong Firebase Authentication > Users chưa, và tài khoản có bị vô hiệu hóa trong mục "Quản lý tài khoản đăng nhập" không.
- **Muốn thêm người được quyền nhập liệu**: dùng mục "Quản lý tài khoản đăng nhập" ngay trong trang nhập liệu — không cần vào Firebase Console, không cần sửa mã nguồn.
- **Muốn đổi tên 4 chức danh hiển thị**: dùng nút "Sửa danh sách 4 chức danh" ngay trong trang nhập liệu, không cần sửa mã nguồn.
