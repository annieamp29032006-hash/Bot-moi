# Hướng dẫn xuất cookies YouTube cho Bot (Server Linux)

> **Tại sao cần cookies?**
> YouTube phát hiện bot chạy trên server và yêu cầu đăng nhập xác thực.
> Bot đang thử nhiều player_client (tv_embedded → ios → mweb) nhưng nếu vẫn bị chặn thì cần cookies.

---

## ✅ Cách 1: Export từ Chrome/Edge trên máy tính Windows (Nhanh nhất)

1. Mở **Chrome** hoặc **Edge**, đăng nhập vào [youtube.com](https://youtube.com)
2. Cài extension: [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
3. Truy cập `youtube.com` → Click icon extension → **Export** → lưu thành `cookies.txt`
4. Upload file `cookies.txt` lên server vào thư mục bot:
   ```bash
   scp cookies.txt user@your-server:/home/diggingocean/Bot-moi/cookies.txt
   ```
5. Restart bot → Done!

---

## ✅ Cách 2: Export từ Chrome trên Server Linux (nếu có GUI)

```bash
yt-dlp --cookies-from-browser chrome --dump-json --no-playlist "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

Nếu thành công, xuất cookies ra file:
```bash
yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

---

## ✅ Cách 3: Dùng Firefox trên Server Linux (Headless)

```bash
# Cài Firefox nếu chưa có
sudo apt install firefox -y

# Export cookies từ Firefox
yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

---

## ⚠️ Lưu ý

- File `cookies.txt` phải nằm ở: `/home/diggingocean/Bot-moi/cookies.txt`
- Cookies YouTube thường hết hạn sau **7-30 ngày**, cần xuất lại định kỳ
- **ĐỪNG** commit `cookies.txt` lên GitHub (đã có trong `.gitignore`)
- Bot tự động dùng cookies nếu file tồn tại, không cần restart code

---

## 🔧 Kiểm tra cookies hoạt động chưa

```bash
cd /home/diggingocean/Bot-moi
./yt-dlp --cookies cookies.txt -j --no-playlist "ytsearch1:Nắng ấm xa dần" | head -c 200
```

Nếu in ra JSON thì cookies hoạt động tốt ✅
