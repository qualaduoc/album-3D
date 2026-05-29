# 👑 Album Kỷ Niệm 3D Tương Tác Siêu Sang Trọng

> Một ứng dụng Web Album ảnh 3D nghệ thuật, tích hợp nhạc nền YouTube và công nghệ nhận diện cử chỉ thông minh AI bằng camera vô cùng sống động.

Ứng dụng được thiết kế tỉ mỉ với hàng chục ngàn hạt ánh sáng lấp lánh (particle), hệ thống đèn màu nghệ thuật và các khung ảnh phong cách Polaroid bay lơ lửng, tạo nên một không gian triển lãm kỷ niệm 3D ảo vô cùng lộng lẫy và giàu cảm xúc.

Tác phẩm được phát triển và tối ưu hóa bởi nhà phát triển **N.T.Đ**.

---

## ✨ Các Tính Năng Nổi Bật

* **👑 Tác Giả & Tác Quyền**: Được sưu tầm từ cái ông gì người TQ hay Japan ý! k nhớ nữa!, tối ưu hóa giao diện và vận hành bởi nhà phát triển **N.T.Đ**.
* **🇻🇳 Tích Hợp Lá Cờ Việt Nam 3D**: Hiệu ứng dựng hình bằng GPU tạo hình Lá cờ đỏ sao vàng uốn lượn lấp lánh cực kỳ chân thực và đầy tự hào dân tộc.
* **🪐 Đa Dạng Giao Diện 3D**: Chuyển đổi linh hoạt giữa các chế độ nghệ thuật:
  * **Cây Kỷ Niệm 3D** (Các bức ảnh kết hợp thành một cây thông kỷ niệm lộng lẫy).
  * **Vũ Trụ & Quỹ Đạo Ảnh** (Hệ mặt trời ảo nơi các bức ảnh xoay quanh tâm trục).
  * **Lá Cờ Việt Nam 3D** (Các hạt ánh sáng kết hợp thành lá cờ Việt Nam đỏ sao vàng).
* **🖐️ Điều Khiển Bằng Cử Chỉ Tay AI**: Nhận diện cử chỉ thông minh qua webcam (camera máy tính/điện thoại) mà không cần dùng chuột:
  * 🖐️ **Mở lòng bàn tay (Open Palm)**: Phân rã (Disperse) album ảnh bay tự do lấp lánh khắp không gian.
  * ✊ **Nắm chặt tay (Closed Fist)**: Tụ hội (Assemble) album ảnh về vị trí cấu trúc 3D chuẩn xác.
  * ✌️ **Ký hiệu Chiến thắng (Victory)** hoặc 👍 **Thích (Thumbs Up)**: Phóng to (Zoom) bức ảnh đang highlight trước màn hình.
* **🎵 Nhạc Nền YouTube Chạy Ngầm**: Cho phép dán liên kết YouTube bất kỳ để phát nhạc nền chạy ẩn dưới client, hỗ trợ nút Tạm dừng/Phát nhạc cực kỳ thuận tiện.
* **🔗 Chia Sẻ Album Siêu Tốc**: Hệ thống mã hóa Base64 toàn bộ hình ảnh, âm nhạc và giao diện đang chọn thành một liên kết (URL) duy nhất. Người nhận chỉ cần bấm link là thưởng thức được ngay thiệp 3D của riêng bạn.

---

## 🛠️ Công Nghệ Sử Dụng

* **Core**: React 18, Vite
* **3D Engine**: Three.js (React Three Fiber / R3F)
* **Kỹ Thuật Hạt & Chuyển Động**: `@react-three/drei`, `maath`
* **Hiệu Ứng Ánh Sáng (Post-processing)**: `@react-three/postprocessing` (hiệu ứng Bloom tỏa sáng và Vignette cổ điển)
* **Trí Tuệ Nhân Tạo (AI)**: Google MediaPipe Tasks Vision (nhận diện cử chỉ tay thời gian thực qua webcam)

---

## 🚀 Hướng Dẫn Khởi Chạy Nhanh

### 1. Chuẩn bị môi trường
Đảm bảo máy tính của bạn đã cài đặt [Node.js](https://nodejs.org/) (khuyến nghị phiên bản v18 trở lên).

### 2. Cài đặt các thư viện cần thiết
Mở cửa sổ dòng lệnh (Terminal/Command Prompt) tại thư mục gốc của dự án và chạy:
```bash
npm install
```

### 3. Khởi chạy cục bộ (Local Development)
Chạy lệnh sau để khởi động máy chủ thử nghiệm:
```bash
npm run dev
```
Sau đó mở trình duyệt theo đường dẫn mặc định: `http://localhost:5173`.

---

## 🖼️ Hướng Dẫn Tùy Biến Album Ảnh Của Riêng Bạn

### Cách 1: Thay đổi trực tiếp trên Giao Diện (Khuyên Dùng)
1. Trên giao diện trang web, bấm vào nút **"CẬP NHẬT ALBUM ẢNH"** ở góc phải màn hình.
2. Dán các đường dẫn (link) ảnh của bạn (hỗ trợ cả link Google Drive công khai và link ảnh trực tiếp `.png`, `.jpg`). Mỗi link ảnh nằm trên một dòng riêng biệt.
3. Bấm **"Cập Nhật Album"** để chiêm ngưỡng tác phẩm tức thì.
4. Bấm **"Chia Sẻ Album"** để sao chép liên kết Base64 gửi tặng bạn bè.

### Cách 2: Thay đổi trong Mã Nguồn
1. Tìm thư mục `public/photos/` trong dự án.
2. Đổi tên bức ảnh bìa/ảnh ngôi sao đỉnh của bạn thành `top.jpg`.
3. Lưu các bức ảnh khác vào thư mục này với tên định dạng số thứ tự: `1.jpg`, `2.jpg`, `3.jpg`...
4. Để cấu hình số lượng ảnh, mở file `src/App.tsx` và chỉnh sửa biến sau ở dòng 20:
   ```typescript
   const TOTAL_NUMBERED_PHOTOS = 31; // Thay đổi bằng số lượng ảnh thực tế của bạn
   ```

---

## 📄 Bản Quyền & Tác Giả

Dự án được chỉnh sửa, Việt hóa 100% và tích hợp các công nghệ chia sẻ nghệ thuật bởi **N.T.Đ**.
Mã nguồn mở dựa trên giấy phép MIT License. (Một ông nào đó mà tôi chả nhớ)

*Chúc Khầy Được luôn có những trải nghiệm công nghệ tuyệt vời và đầy cảm hứng nghệ thuật! 🇻🇳✨*
