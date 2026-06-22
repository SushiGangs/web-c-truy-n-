import { DB } from './db.js';
import { UI } from './ui.js';

export const Editor = {
    quill: null,
    currentStoryId: null,
    tempCoverBase64: '',
    tempAvatarBase64: '',
    cropper: null,
    cropTarget: '',
    autoSaveInterval: null,

    initQuill() {
        if(!this.quill) {
            this.quill = new Quill('#quill-editor', {
                theme: 'snow',
                placeholder: 'Bắt đầu viết chương của bạn...',
                modules: { toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    ['blockquote', 'code-block'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'indent': '-1'}, { 'indent': '+1' }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['clean']
                ]}
            });

            // Tùy chỉnh xử lý nút Image (Tải lên Supabase Storage)
            this.quill.getModule('toolbar').addHandler('image', () => {
                const input = document.createElement('input');
                input.setAttribute('type', 'file');
                input.setAttribute('accept', 'image/*');
                input.click();

                input.onchange = async () => {
                    const file = input.files[0];
                    if (file) {
                        try {
                            UI.toast('Đang tải ảnh lên...', 'info');
                            const ext = file.name.split('.').pop();
                            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
                            
                            const { data, error } = await DB.supabase.storage.from('images').upload(`editor/${fileName}`, file);
                            if (error) throw error;
                            
                            const { data: urlData } = DB.supabase.storage.from('images').getPublicUrl(`editor/${fileName}`);
                            
                            const range = this.quill.getSelection(true);
                            this.quill.insertEmbed(range.index, 'image', urlData.publicUrl);
                            this.quill.setSelection(range.index + 1);
                        } catch (e) {
                            UI.toast('Lỗi tải ảnh lên Cloud', 'error');
                            console.error(e);
                        }
                    }
                };
            });

            // Lắng nghe thay đổi nội dung
            this.quill.on('text-change', () => {
                this.updateWordCount();
                this.scheduleAutoSave();
            });
        }
    },

    updateWordCount() {
        const text = this.quill.getText().trim();
        const words = text.length > 0 ? text.split(/\s+/).length : 0;
        const chars = text.length;
        const countEl = document.getElementById('editor-word-count');
        if (countEl) countEl.innerText = `${words.toLocaleString()} từ | ${chars.toLocaleString()} ký tự`;
    },

    scheduleAutoSave() {
        if(this.autoSaveInterval) clearTimeout(this.autoSaveInterval);
        this.autoSaveInterval = setTimeout(() => {
            const content = this.quill.root.innerHTML;
            const cId = document.getElementById('editing-chapter-id').value || 'new';
            const draftKey = `sushi_draft_${this.currentStoryId}_${cId}`;
            localStorage.setItem(draftKey, content);
            
            const saveEl = document.getElementById('editor-save-status');
            if(saveEl) saveEl.innerText = `Đã lưu nháp (${new Date().toLocaleTimeString('vi-VN')})`;
        }, 3000);
    },

    async saveStoryMetadata() {
        const id = document.getElementById('edit-story-id').value;
        const title = document.getElementById('story-title').value.trim();
        const desc = document.getElementById('story-desc').value.trim();
        const tags = window.app.selectedTags || [];
        const allowDown = document.getElementById('story-allow-download').checked;
        const isPublished = document.getElementById('story-status').value === "true";
        const cover = this.tempCoverBase64;

        if(!title) { UI.toast('Vui lòng nhập tiêu đề!', 'error'); return; }

        UI.toast('Đang lưu thông tin...', 'info');
        try {
            const savedStory = await DB.saveStory({
                id: id || null,
                title, desc, tags, allowDownload: allowDown, cover, isPublished
            });
            UI.toast('Lưu truyện thành công!', 'success');
            
            if(!id && savedStory) {
                // Mới tạo -> Load lại giao diện Edit
                window.app.editStory(savedStory.id);
            } else {
                window.app.showMyStoriesManager();
            }
        } catch(e) {
            UI.toast('Lỗi khi lưu truyện: ' + (e.message || e), 'error');
            console.error(e);
        }
    },

    async saveChapter() {
        const cId = document.getElementById('editing-chapter-id').value;
        const title = document.getElementById('chapter-title').value.trim();
        const content = this.quill.root.innerHTML;
        const isPublished = document.getElementById('chapter-status').value === "true";

        if(!title || content === '<p><br></p>') { UI.toast('Nhập tên chương và nội dung!', 'error'); return; }

        UI.toast('Đang lưu chương...', 'info');
        try {
            // Xác định order
            let order = 1;
            if(!cId) {
                const chaps = await DB.getChapters(this.currentStoryId, true);
                order = chaps.length + 1;
            }

            await DB.saveChapter({
                id: cId || null,
                storyId: this.currentStoryId,
                title, content, order: cId ? undefined : order, isPublished
            });

            UI.toast('Lưu chương thành công!', 'success');
            const draftKey = `sushi_draft_${this.currentStoryId}_${cId || 'new'}`;
            localStorage.removeItem(draftKey); // Xóa nháp sau khi lưu cloud
            
            window.app.editStory(this.currentStoryId);
        } catch(e) {
            UI.toast('Lỗi khi lưu chương: ' + (e.message || e), 'error');
            console.error(e);
        }
    },

    // ... Cropper functions ...
    openCropper(event, target) {
        const file = event.target.files[0];
        if(!file) return;
        this.cropTarget = target;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imgEl = document.getElementById('cropper-image');
            imgEl.src = e.target.result;
            
            document.getElementById('modal-cropper').classList.remove('hidden');

            if(this.cropper) this.cropper.destroy();
            const ratio = target === 'avatar' ? 1 : (16/9);

            this.cropper = new Cropper(imgEl, {
                aspectRatio: ratio, viewMode: 2, dragMode: 'move', autoCropArea: 0.9, restore: false,
                guides: true, center: true, highlight: false, cropBoxMovable: true, cropBoxResizable: true, toggleDragModeOnDblclick: false,
            });
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    },

    closeCropperModal() {
        document.getElementById('modal-cropper').classList.add('hidden');
        if(this.cropper) { this.cropper.destroy(); this.cropper = null; }
    },

    confirmCrop() {
        if(!this.cropper) return;
        
        const width = this.cropTarget === 'avatar' ? 200 : 800;
        const height = this.cropTarget === 'avatar' ? 200 : 450;

        const canvas = this.cropper.getCroppedCanvas({ width, height, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
        const base64Str = canvas.toDataURL('image/jpeg', 0.8);

        if(this.cropTarget === 'avatar') {
            this.tempAvatarBase64 = base64Str;
            const preview = document.getElementById('profile-avatar-preview');
            preview.style.backgroundImage = `url(${base64Str})`;
            preview.innerText = '';
        } else if(this.cropTarget === 'cover') {
            this.tempCoverBase64 = base64Str;
            const img = document.getElementById('story-cover-preview');
            img.src = base64Str;
            img.style.display = 'block';
            document.getElementById('btn-remove-cover').classList.remove('hidden');
        }

        this.closeCropperModal();
    }
};
