// Script tạo từ điển Tiếng Việt sạch cho game Nối Từ
// Chạy: node build_vn_dict.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Danh sách các âm tiết tiếng Việt hợp lệ (phổ biến)
// Nếu CẢ 2 âm tiết đều là âm tiết tiếng Việt thông dụng → từ ghép hợp lệ
const COMMON_SYLLABLES = new Set();

// Vietnamese diacritical patterns
const VN_LOWER_CHARS = /^[a-zàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]+$/;

async function main() {
    console.log('🔄 Bắt đầu xây dựng từ điển sạch...\n');
    
    // Tải Viet39K (chất lượng cao hơn) nếu chưa có
    const viet39kPath = path.join(__dirname, 'Viet39K.txt');
    if (!fs.existsSync(viet39kPath)) {
        console.log('📥 Đang tải Viet39K.txt...');
        try {
            const res = await axios.get('https://raw.githubusercontent.com/duyet/vietnamese-wordlist/master/Viet39K.txt');
            fs.writeFileSync(viet39kPath, res.data);
            console.log('✅ Đã tải Viet39K.txt');
        } catch (err) {
            console.error('❌ Lỗi tải Viet39K:', err.message);
        }
    }

    // Thu thập từ tất cả nguồn
    const allWords = new Set();
    const sources = [
        path.join(__dirname, 'vn_words.txt'),
        viet39kPath
    ];

    for (const srcPath of sources) {
        if (!fs.existsSync(srcPath)) continue;
        console.log(`📖 Đọc: ${path.basename(srcPath)}`);
        const lines = fs.readFileSync(srcPath, 'utf-8').split('\n');
        let count = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(' ');
            if (parts.length !== 2) continue;
            
            const lower = trimmed.toLowerCase();
            const p1 = parts[0].toLowerCase();
            const p2 = parts[1].toLowerCase();
            
            // === BỘ LỌC ===
            
            // 1. Loại tên riêng (cả 2 âm tiết viết hoa)
            if (/^[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ]/.test(parts[0]) && 
                /^[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ]/.test(parts[1])) continue;
            
            // 2. Loại từ có gạch nối
            if (trimmed.includes('-')) continue;
            
            // 3. Loại từ có số, ký tự đặc biệt
            if (/[0-9()[\]{}.,;:!?'"\/\\@#$%^&*+=<>~`]/.test(trimmed)) continue;
            
            // 4. Loại từ viết tắt (toàn chữ hoa)
            if (parts[0] === parts[0].toUpperCase() && /^[A-Z]+$/.test(parts[0])) continue;
            if (parts[1] === parts[1].toUpperCase() && /^[A-Z]+$/.test(parts[1])) continue;
            
            // 5. Kiểm tra cả 2 âm tiết phải là ký tự tiếng Việt hợp lệ
            if (!VN_LOWER_CHARS.test(p1) || !VN_LOWER_CHARS.test(p2)) continue;
            
            // 6. Loại âm tiết quá ngắn (1 ký tự trừ một số từ hợp lệ)
            const validSingleChars = new Set(['a', 'ả', 'ạ', 'à', 'á', 'ã', 'ơ', 'ờ', 'ớ', 'ở', 'ỡ', 'ợ', 'ư', 'ứ', 'ừ', 'ử', 'ữ', 'ự', 'ô', 'ồ', 'ố', 'ổ', 'ỗ', 'ộ', 'ê', 'ề', 'ế', 'ể', 'ễ', 'ệ', 'â', 'ầ', 'ấ', 'ẩ', 'ẫ', 'ậ', 'ă', 'ằ', 'ắ', 'ẳ', 'ẵ', 'ặ', 'ò', 'ó', 'ỏ', 'õ', 'ọ', 'è', 'é', 'ẻ', 'ẽ', 'ẹ', 'ì', 'í', 'ỉ', 'ĩ', 'ị', 'ù', 'ú', 'ủ', 'ũ', 'ụ', 'ỳ', 'ý', 'ỷ', 'ỹ', 'ỵ', 'đ']);
            if (p1.length === 1 && !validSingleChars.has(p1)) continue;
            if (p2.length === 1 && !validSingleChars.has(p2)) continue;
            
            // 7. Loại âm tiết dài bất thường (> 8 ký tự thường là từ lạ)
            if (p1.length > 8 || p2.length > 8) continue;
            
            allWords.add(lower);
            count++;
        }
        console.log(`   → ${count} từ ghép 2 âm tiết hợp lệ`);
    }
    
    // Sắp xếp theo alphabet và lưu
    const sorted = Array.from(allWords).sort((a, b) => a.localeCompare(b, 'vi'));
    const outputPath = path.join(__dirname, 'vn_words_clean.txt');
    fs.writeFileSync(outputPath, sorted.join('\n'), 'utf-8');
    
    console.log(`\n✅ Hoàn thành! Đã tạo file: vn_words_clean.txt`);
    console.log(`📊 Tổng: ${sorted.length} từ ghép sạch`);
    
    // Thống kê nối từ
    const startMap = new Map(); // âm tiết đầu → count
    for (const word of sorted) {
        const first = word.split(' ')[0];
        startMap.set(first, (startMap.get(first) || 0) + 1);
    }
    const avgChain = Array.from(startMap.values()).reduce((s, v) => s + v, 0) / startMap.size;
    console.log(`📊 Số âm tiết bắt đầu khác nhau: ${startMap.size}`);
    console.log(`📊 Trung bình ${avgChain.toFixed(1)} từ có thể nối cho mỗi âm tiết`);
    
    // Kiểm tra dead-end words (không thể nối tiếp)
    const secondSyllables = new Set();
    for (const word of sorted) {
        secondSyllables.add(word.split(' ')[1]);
    }
    let deadEnds = 0;
    for (const syl of secondSyllables) {
        if (!startMap.has(syl)) deadEnds++;
    }
    console.log(`📊 Số âm tiết "ngõ cụt" (không thể nối tiếp): ${deadEnds}/${secondSyllables.size}`);
}

main().catch(console.error);
