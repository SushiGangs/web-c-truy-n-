// --- STATIC DATABASE ENGINE (LocalStorage) ---
const DB = {
    init() {
        if (!localStorage.getItem('sushi_profile')) {
            localStorage.setItem('sushi_profile', JSON.stringify({ penName: 'Tác Giả Mới', bio: '', accountType: 'public', avatar: '' }));
        }
        if (!localStorage.getItem('sushi_stories')) localStorage.setItem('sushi_stories', JSON.stringify([]));
        if (!localStorage.getItem('sushi_chapters')) localStorage.setItem('sushi_chapters', JSON.stringify([]));
        
        // Migration Lịch sử đọc sang object mới { storyId, chapterId, timestamp }
        let historyRaw = localStorage.getItem('sushi_history');
        if (!historyRaw) {
            localStorage.setItem('sushi_history', JSON.stringify([]));
        } else {
            let historyArr = JSON.parse(historyRaw);
            if (historyArr.length > 0 && typeof historyArr[0] === 'string') {
                // Đang dùng format cũ (chỉ lưu ID truyện), convert sang format mới
                historyArr = historyArr.map(id => ({ storyId: id, chapterId: null, timestamp: Date.now() }));
                localStorage.setItem('sushi_history', JSON.stringify(historyArr));
            }
        }
        
        if (!localStorage.getItem('sushi_following')) localStorage.setItem('sushi_following', JSON.stringify([]));
        if (!localStorage.getItem('sushi_settings')) localStorage.setItem('sushi_settings', JSON.stringify({ darkMode: false }));
        if (!localStorage.getItem('sushi_reader_settings')) localStorage.setItem('sushi_reader_settings', JSON.stringify({ font: "'Inter', sans-serif", size: 18, theme: 'light' }));
    },
    get(key) { return JSON.parse(localStorage.getItem(key)); },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
    genId() { return Date.now().toString(36) + Math.random().toString(36).substring(2, 6); }
};

const app = {
    quill: null,
    cropper: null,
    currentStoryId: null,
    currentChapterId: null,
    currentTag: '',
    tempAvatarBase64: '',
    tempCoverBase64: '',
    cropTarget: '',
    searchTimeout: null,
    lastScrollY: 0,
    confirmCallback: null,

    init() {
        DB.init();
        this.applySettings();
        this.updateAvatar();
        this.showHome();
        this.initScrollAndKeys();
        
        // Click ra ngoài đóng dropdown
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.avatar-container')) {
                document.getElementById('avatar-dropdown').classList.remove('show');
            }
        });

        // Bẫy phím ESC đóng Modal
        document.addEventListener('keydown', (e) => {
            if(e.key === 'Escape') this.closeModals();
        });
    },

    // --- CUSTOM UI: TOAST & CONFIRM ---
    toast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'warning-octagon' : 'info';
        toast.innerHTML = `<i class="ph ph-${icon} toast-icon"></i> <span>${message}</span>`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('toast-fadeOut');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    confirm(message, callback) {
        document.getElementById('confirm-message').innerText = message;
        document.getElementById('modal-confirm').classList.remove('hidden');
        this.confirmCallback = callback;
        // Bắt sự kiện click OK
        const btnOk = document.getElementById('btn-confirm-ok');
        btnOk.onclick = () => {
            document.getElementById('modal-confirm').classList.add('hidden');
            if(this.confirmCallback) this.confirmCallback();
        };
    },

    closeConfirmModal() {
        document.getElementById('modal-confirm').classList.add('hidden');
        this.confirmCallback = null;
    },

    // --- SETTINGS ---
    applySettings() {
        const settings = DB.get('sushi_settings');
        if (settings.darkMode) {
            document.body.classList.add('dark-mode');
            document.getElementById('dark-mode-icon').className = 'ph ph-sun';
            document.getElementById('dark-mode-text').innerText = 'Giao Diện Sáng';
        } else {
            document.body.classList.remove('dark-mode');
            document.getElementById('dark-mode-icon').className = 'ph ph-moon';
            document.getElementById('dark-mode-text').innerText = 'Giao Diện Tối';
        }
    },

    toggleDarkMode() {
        const settings = DB.get('sushi_settings');
        settings.darkMode = !settings.darkMode;
        DB.set('sushi_settings', settings);
        this.applySettings();
        this.toggleDropdown();
        this.toast('Đã thay đổi giao diện', 'info');
    },

    // --- SCROLL & KEYBOARD LOGIC ---
    initScrollAndKeys() {
        window.addEventListener('scroll', () => {
            const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = (winScroll / height) * 100;
            document.getElementById('reading-progress-bar').style.width = scrolled + "%";

            // Logic ẩn/hiện Floating Toolbar
            const toolbar = document.getElementById('reading-toolbar');
            if(toolbar && !document.getElementById('view-read-chapter').classList.contains('hidden')) {
                if(winScroll > this.lastScrollY && winScroll > 100) {
                    toolbar.classList.add('hidden-scroll'); // Cuộn xuống -> ẩn
                } else {
                    toolbar.classList.remove('hidden-scroll'); // Cuộn lên -> hiện
                }
            }
            this.lastScrollY = winScroll;
        });

        // Click vào nội dung sẽ hiện lại toolbar nếu đang ẩn
        document.addEventListener('click', (e) => {
            if(!document.getElementById('view-read-chapter').classList.contains('hidden')) {
                const toolbar = document.getElementById('reading-toolbar');
                if(!e.target.closest('#reading-toolbar') && !e.target.closest('.read-header') && !e.target.closest('.btn')) {
                    toolbar.classList.remove('hidden-scroll');
                }
            }
        });

        // Bàn phím trái/phải chuyển chương
        document.addEventListener('keydown', (e) => {
            if(!document.getElementById('view-read-chapter').classList.contains('hidden') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                if(e.key === 'ArrowRight') {
                    const btn = document.getElementById('tool-next');
                    if(!btn.classList.contains('btn-disabled')) this.nextChapter();
                }
                if(e.key === 'ArrowLeft') {
                    const btn = document.getElementById('tool-prev');
                    if(!btn.classList.contains('btn-disabled')) this.prevChapter();
                }
            }
        });
    },

    // --- AVATAR & DROPDOWN ---
    updateAvatar() {
        const p = DB.get('sushi_profile');
        const avatar = document.getElementById('user-avatar');
        if (p.avatar) {
            avatar.style.backgroundImage = `url(${p.avatar})`;
            avatar.innerText = '';
        } else {
            avatar.style.backgroundImage = 'none';
            avatar.innerText = p.penName.charAt(0).toUpperCase() || 'U';
        }
    },

    toggleDropdown() {
        document.getElementById('avatar-dropdown').classList.toggle('show');
    },

    hideAllViews() {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        this.closeModals();
        window.scrollTo(0, 0);
    },

    showHome() {
        this.hideAllViews();
        document.getElementById('view-home').classList.remove('hidden');
        this.renderStories();
    },

    // --- CROPPER ---
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
    },

    // --- PROFILE VIEW ---
    showProfileView() {
        this.hideAllViews();
        document.getElementById('avatar-dropdown').classList.remove('show');
        document.getElementById('view-profile').classList.remove('hidden');

        const p = DB.get('sushi_profile');
        document.getElementById('profile-penname').value = p.penName;
        document.getElementById('profile-bio').value = p.bio || '';
        document.getElementById('profile-account-type').value = p.accountType || 'public';
        
        const preview = document.getElementById('profile-avatar-preview');
        if (p.avatar) {
            preview.style.backgroundImage = `url(${p.avatar})`;
            preview.innerText = '';
            this.tempAvatarBase64 = p.avatar;
        } else {
            preview.style.backgroundImage = 'none';
            preview.innerText = p.penName.charAt(0).toUpperCase() || 'U';
            this.tempAvatarBase64 = '';
        }
    },

    saveProfile() {
        const penName = document.getElementById('profile-penname').value.trim() || 'Tác Giả';
        const bio = document.getElementById('profile-bio').value.trim();
        const accountType = document.getElementById('profile-account-type').value;
        const avatar = this.tempAvatarBase64;
        
        DB.set('sushi_profile', { penName, bio, accountType, avatar });
        this.updateAvatar();
        this.toast("Lưu hồ sơ thành công!");
    },

    // --- MY STORIES MANAGER ---
    showMyStoriesManager() {
        this.hideAllViews();
        document.getElementById('avatar-dropdown').classList.remove('show');
        document.getElementById('view-my-stories').classList.remove('hidden');
        
        const grid = document.getElementById('my-stories-grid');
        grid.innerHTML = '';
        const stories = DB.get('sushi_stories');
        
        if(stories.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-books"></i>
                    <p>Bạn chưa có truyện nào. Hãy bắt đầu hành trình sáng tác!</p>
                    <button class="btn btn-primary" onclick="app.showWriteStory()"><i class="ph ph-pencil-simple"></i> Viết Truyện Ngay</button>
                </div>`;
            return;
        }

        stories.forEach(s => {
            const card = document.createElement('div');
            card.className = 'story-card';
            
            const coverHtml = s.cover ? `<img src="${s.cover}" class="story-card-cover" loading="lazy" alt="Cover">` : `<div class="story-card-cover"></div>`;
            
            card.innerHTML = `
                ${coverHtml}
                <div class="story-card-content">
                    <h3>${this.escapeHTML(s.title)}</h3>
                    <div class="story-desc">${this.escapeHTML(s.desc || 'Chưa có mô tả')}</div>
                    <div class="story-meta">
                        <span>${s.chaptersCount} chương</span>
                    </div>
                </div>
                <div class="gear-icon" title="Chỉnh sửa truyện" onclick="app.editStory('${s.id}')">
                    <i class="ph ph-gear"></i>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    // --- MODALS (HISTORY, FOLLOWING) ---
    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add('hidden'));
        this.closeCropperModal();
    },

    openHistoryModal() {
        this.closeModals();
        document.getElementById('avatar-dropdown').classList.remove('show');
        const historyIds = DB.get('sushi_history');
        this.renderListInModal('history-list', historyIds, 'Chưa có lịch sử đọc.', true);
        document.getElementById('modal-history').classList.remove('hidden');
    },

    openFollowingModal() {
        this.closeModals();
        document.getElementById('avatar-dropdown').classList.remove('show');
        const followIds = DB.get('sushi_following');
        // following là list IDs. convert sang object tạm để render chung hàm
        const followObjs = followIds.map(id => ({ storyId: id }));
        this.renderListInModal('following-list', followObjs, 'Bạn chưa theo dõi truyện nào.', false);
        document.getElementById('modal-following').classList.remove('hidden');
    },

    renderListInModal(containerId, dataArr, emptyMsg, isHistory) {
        const list = document.getElementById(containerId);
        list.innerHTML = '';
        if(dataArr.length === 0) { 
            list.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-ghost"></i>
                    <p>${emptyMsg}</p>
                </div>`; 
            return; 
        }
        
        const allStories = DB.get('sushi_stories');
        const allChaps = DB.get('sushi_chapters');

        dataArr.forEach(item => {
            const s = allStories.find(st => st.id === item.storyId);
            if(s) {
                const div = document.createElement('div');
                div.className = 'chapter-item';
                
                let chapterInfo = '';
                if(isHistory && item.chapterId) {
                    const c = allChaps.find(x => x.id === item.chapterId);
                    if(c) chapterInfo = `<br><small style="color:var(--primary-color);">Đang đọc: Chương ${c.order}</small>`;
                }

                div.innerHTML = `
                    <div style="flex:1;"><strong>${this.escapeHTML(s.title)}</strong>${chapterInfo}</div>
                    <button class="btn btn-outline" onclick="app.readStoryInfo('${s.id}')">Chi tiết</button>
                `;
                list.appendChild(div);
            }
        });
    },

    switchAccount() {
        this.toast("Dùng chức năng Đăng Xuất (Xóa dữ liệu) để tạo bản web trống mới.", "info");
    },

    clearData() {
        this.confirm("CẢNH BÁO: Xóa dữ liệu sẽ làm mất toàn bộ truyện và tài khoản trên trình duyệt này! Bạn có chắc chắn muốn xóa?", () => {
            localStorage.clear();
            location.reload();
        });
    },

    // --- CREATE/EDIT STORY ---
    showWriteStory() {
        this.hideAllViews();
        document.getElementById('avatar-dropdown').classList.remove('show');
        document.getElementById('view-write').classList.remove('hidden');
        document.getElementById('write-title-heading').innerText = 'Tạo Bộ Truyện Mới';
        document.getElementById('edit-story-id').value = '';
        document.getElementById('story-title').value = '';
        document.getElementById('story-desc').value = '';
        document.getElementById('story-tags').value = '';
        document.getElementById('story-allow-download').checked = true;
        
        this.tempCoverBase64 = '';
        document.getElementById('story-cover-preview').style.display = 'none';
        document.getElementById('btn-remove-cover').classList.add('hidden');

        document.getElementById('btn-add-chapter').classList.add('hidden');
        document.getElementById('btn-delete-story').classList.add('hidden');
        document.getElementById('edit-chapter-list').classList.add('hidden');
        this.currentStoryId = null;
    },

    editStory(id) {
        const story = DB.get('sushi_stories').find(s => s.id === id);
        if(!story) return;
        this.hideAllViews();
        document.getElementById('view-write').classList.remove('hidden');
        document.getElementById('write-title-heading').innerText = 'Chỉnh Sửa Bộ Truyện';
        
        document.getElementById('edit-story-id').value = story.id;
        document.getElementById('story-title').value = story.title;
        document.getElementById('story-desc').value = story.desc || '';
        document.getElementById('story-tags').value = story.tags ? story.tags.join(', ') : '';
        document.getElementById('story-allow-download').checked = story.allowDownload !== false;
        
        if(story.cover) {
            this.tempCoverBase64 = story.cover;
            const img = document.getElementById('story-cover-preview');
            img.src = story.cover;
            img.style.display = 'block';
            document.getElementById('btn-remove-cover').classList.remove('hidden');
        } else {
            this.tempCoverBase64 = '';
            document.getElementById('story-cover-preview').style.display = 'none';
            document.getElementById('btn-remove-cover').classList.add('hidden');
        }

        document.getElementById('btn-add-chapter').classList.remove('hidden');
        document.getElementById('btn-delete-story').classList.remove('hidden');
        document.getElementById('edit-chapter-list').classList.remove('hidden');
        this.currentStoryId = story.id;
        this.renderChaptersEditList();
    },

    removeCover() {
        this.tempCoverBase64 = '';
        document.getElementById('story-cover-preview').style.display = 'none';
        document.getElementById('btn-remove-cover').classList.add('hidden');
        document.getElementById('story-cover-upload').value = '';
    },

    saveStoryMetadata() {
        const id = document.getElementById('edit-story-id').value;
        const title = document.getElementById('story-title').value.trim();
        const desc = document.getElementById('story-desc').value.trim();
        const tagsStr = document.getElementById('story-tags').value;
        const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t);
        const allowDown = document.getElementById('story-allow-download').checked;
        const cover = this.tempCoverBase64;

        if(!title) { this.toast('Vui lòng nhập tiêu đề!', 'error'); return; }

        const stories = DB.get('sushi_stories');
        const p = DB.get('sushi_profile');

        if(id) {
            const idx = stories.findIndex(s => s.id === id);
            stories[idx] = { ...stories[idx], title, desc, tags, allowDownload: allowDown, cover };
            DB.set('sushi_stories', stories);
            this.toast('Đã cập nhật thông tin truyện!', 'success');
            this.showMyStoriesManager();
        } else {
            const newId = DB.genId();
            stories.unshift({
                id: newId, title, desc, tags, allowDownload: allowDown, cover,
                author: p.penName, chaptersCount: 0, date: Date.now()
            });
            DB.set('sushi_stories', stories);
            this.toast('Tạo truyện thành công!', 'success');
            this.editStory(newId);
        }
    },

    promptDeleteStory() {
        const id = this.currentStoryId;
        if(!id) return;
        this.confirm("CẢNH BÁO TỐI KHẨN: Bạn có chắc chắn muốn XÓA VĨNH VIỄN bộ truyện này không? Toàn bộ các chương của truyện cũng sẽ bốc hơi!", () => {
            const stories = DB.get('sushi_stories').filter(s => s.id !== id);
            const chaps = DB.get('sushi_chapters').filter(c => c.storyId !== id);
            const history = DB.get('sushi_history').filter(h => h.storyId !== id);
            const following = DB.get('sushi_following').filter(f => f !== id);
            
            DB.set('sushi_stories', stories);
            DB.set('sushi_chapters', chaps);
            DB.set('sushi_history', history);
            DB.set('sushi_following', following);
            
            this.toast('🗑️ Đã xóa truyện thành công!');
            this.showMyStoriesManager();
        });
    },

    // --- CHAPTER MANAGEMENT ---
    openChapterEditor(chapterId = null) {
        this.hideAllViews();
        document.getElementById('view-edit-chapter').classList.remove('hidden');
        
        if(!this.quill) {
            this.quill = new Quill('#quill-editor', {
                theme: 'snow',
                placeholder: 'Nội dung chương...',
                modules: { toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    ['blockquote', 'code-block'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'align': [] }],
                    ['clean']
                ]}
            });
        }

        if(chapterId) {
            const chaps = DB.get('sushi_chapters');
            const c = chaps.find(x => x.id === chapterId);
            document.getElementById('editing-chapter-id').value = c.id;
            document.getElementById('chapter-title').value = c.title;
            this.quill.root.innerHTML = c.content;
        } else {
            document.getElementById('editing-chapter-id').value = '';
            document.getElementById('chapter-title').value = '';
            this.quill.root.innerHTML = '';
        }
    },

    closeChapterEditor() {
        this.editStory(this.currentStoryId);
    },

    saveChapter() {
        const cId = document.getElementById('editing-chapter-id').value;
        const title = document.getElementById('chapter-title').value.trim();
        const content = this.quill.root.innerHTML;

        if(!title || content === '<p><br></p>') { this.toast('Nhập tên chương và nội dung!', 'error'); return; }

        const chaps = DB.get('sushi_chapters');
        if(cId) {
            const idx = chaps.findIndex(c => c.id === cId);
            chaps[idx] = { ...chaps[idx], title, content };
            this.toast('Đã cập nhật chương!', 'success');
        } else {
            const sId = this.currentStoryId;
            const myChaps = chaps.filter(c => c.storyId === sId);
            chaps.push({ id: DB.genId(), storyId: sId, title, content, order: myChaps.length + 1 });
            
            const stories = DB.get('sushi_stories');
            const sIdx = stories.findIndex(s => s.id === sId);
            stories[sIdx].chaptersCount = myChaps.length + 1;
            DB.set('sushi_stories', stories);
            this.toast('Đã thêm chương mới!', 'success');
        }
        DB.set('sushi_chapters', chaps);
        this.closeChapterEditor();
    },

    renderChaptersEditList() {
        const container = document.getElementById('chapters-container');
        container.innerHTML = '';
        const chaps = DB.get('sushi_chapters').filter(c => c.storyId === this.currentStoryId).sort((a,b)=>a.order - b.order);
        if(chaps.length === 0) container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Chưa có chương nào.</p>';
        
        chaps.forEach(c => {
            const d = document.createElement('div');
            d.className = 'chapter-item';
            d.innerHTML = `<span>${c.order}. ${this.escapeHTML(c.title)}</span> <button class="btn btn-outline" onclick="app.openChapterEditor('${c.id}')"><i class="ph ph-pencil-simple"></i> Sửa</button>`;
            container.appendChild(d);
        });
    },

    // --- SEARCH & HOME ---
    handleSearchDebounced(e) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.renderStories();
        }, 250);
    },

    renderStories() {
        const grid = document.getElementById('stories-list');
        const term = document.getElementById('search-input').value.toLowerCase();
        let stories = DB.get('sushi_stories');

        if(this.currentTag) stories = stories.filter(s => s.tags && s.tags.includes(this.currentTag));
        if(term) stories = stories.filter(s => s.title.toLowerCase().includes(term) || s.author.toLowerCase().includes(term));

        grid.innerHTML = '';
        if(stories.length===0) { 
            grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <i class="ph ph-books"></i>
                <p>Không tìm thấy truyện nào.</p>
            </div>`; 
            return; 
        }

        stories.forEach(s => {
            const card = document.createElement('div');
            card.className = 'story-card';
            card.onclick = () => this.readStoryInfo(s.id);
            
            const coverHtml = s.cover ? `<img src="${s.cover}" class="story-card-cover" loading="lazy" alt="Cover">` : `<div class="story-card-cover"></div>`;
            const tagsHtml = s.tags ? s.tags.map(t=>`<span>${t}</span>`).join('') : '';
            
            card.innerHTML = `
                ${coverHtml}
                <div class="story-card-content">
                    <h3>${this.escapeHTML(s.title)}</h3>
                    <div class="story-tags">${tagsHtml}</div>
                    <div class="story-desc">${this.escapeHTML(s.desc || 'Chưa có mô tả.')}</div>
                    <div class="story-meta">
                        <span><i class="ph ph-user"></i> <strong>${this.escapeHTML(s.author)}</strong></span>
                        <span><i class="ph ph-list-numbers"></i> ${s.chaptersCount} chương</span>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    filterByTag(tag) {
        this.currentTag = tag;
        document.querySelectorAll('#home-tags .tag-pill').forEach(el => {
            el.classList.remove('active');
            if(el.innerText === tag || (tag === '' && el.innerText === 'Tất cả')) el.classList.add('active');
        });
        this.renderStories();
    },

    // --- READING LOGIC ---
    readStoryInfo(id) {
        this.hideAllViews();
        const story = DB.get('sushi_stories').find(s => s.id === id);
        if(!story) return;

        this.currentStoryId = id;
        
        document.getElementById('view-read-info').classList.remove('hidden');
        document.getElementById('info-title').innerText = story.title;
        document.getElementById('info-author').innerText = story.author;
        document.getElementById('info-desc').innerText = story.desc || 'Chưa có mô tả.';
        
        const coverImg = document.getElementById('info-cover');
        if(story.cover) {
            coverImg.src = story.cover;
            coverImg.style.display = 'block';
        } else {
            coverImg.style.display = 'none';
        }

        const tagsHtml = story.tags ? story.tags.map(t=>`<span class="tag-pill" style="font-size:12px;">${t}</span>`).join('') : '';
        document.getElementById('info-tags').innerHTML = tagsHtml;

        const following = DB.get('sushi_following');
        const btnF = document.getElementById('btn-follow');
        if(following.includes(id)) { btnF.innerHTML = '<i class="ph ph-heart-break"></i> Bỏ theo dõi'; btnF.classList.remove('btn-primary'); btnF.classList.add('btn-outline'); }
        else { btnF.innerHTML = '<i class="ph ph-heart"></i> Theo dõi'; btnF.classList.remove('btn-outline'); btnF.classList.add('btn-primary'); }

        const btnD = document.getElementById('btn-download');
        if(story.allowDownload !== false) {
            btnD.classList.remove('hidden');
            btnD.onclick = () => this.downloadSingleStory(id);
        } else {
            btnD.classList.add('hidden');
        }

        // Logic History & Continue Reading
        let history = DB.get('sushi_history');
        const historyItem = history.find(h => h.storyId === id);
        const btnContinue = document.getElementById('btn-continue-read');
        const allChaps = DB.get('sushi_chapters').filter(c => c.storyId === id).sort((a,b)=>a.order - b.order);

        if(historyItem && historyItem.chapterId && allChaps.length > 0) {
            const chap = allChaps.find(x => x.id === historyItem.chapterId);
            if(chap) {
                btnContinue.classList.remove('hidden');
                document.getElementById('continue-read-text').innerText = `Đọc tiếp Chương ${chap.order}`;
            } else {
                btnContinue.classList.add('hidden');
            }
        } else {
            btnContinue.classList.add('hidden');
        }

        // Render chapters list
        const cList = document.getElementById('read-chapter-list');
        cList.innerHTML = '';
        if(allChaps.length===0) cList.innerHTML = '<p style="color:var(--text-muted)">Truyện chưa có chương.</p>';
        allChaps.forEach(c => {
            const d = document.createElement('button');
            d.className = 'chapter-item';
            if(historyItem && historyItem.chapterId === c.id) d.style.borderColor = "var(--primary-color)";
            d.innerHTML = `<span>Chương ${c.order}: ${this.escapeHTML(c.title)}</span> <span style="font-size:12px; color:var(--primary-color);">Đọc <i class="ph ph-caret-right"></i></span>`;
            d.onclick = () => this.readChapter(c.id);
            cList.appendChild(d);
        });
    },

    continueReading() {
        const history = DB.get('sushi_history');
        const item = history.find(h => h.storyId === this.currentStoryId);
        if(item && item.chapterId) {
            this.readChapter(item.chapterId);
        }
    },

    toggleFollow() {
        let follows = DB.get('sushi_following');
        if(follows.includes(this.currentStoryId)) {
            follows = follows.filter(x => x !== this.currentStoryId);
            this.toast('Đã bỏ theo dõi');
        } else {
            follows.push(this.currentStoryId);
            this.toast('Đã thêm vào mục Theo dõi', 'success');
        }
        DB.set('sushi_following', follows);
        this.readStoryInfo(this.currentStoryId);
    },

    readChapter(cId) {
        this.hideAllViews();
        const chaps = DB.get('sushi_chapters').filter(c => c.storyId === this.currentStoryId).sort((a,b)=>a.order - b.order);
        const chap = chaps.find(x => x.id === cId);
        this.currentChapterId = cId;
        
        document.getElementById('view-read-chapter').classList.remove('hidden');
        document.getElementById('read-chapter-title').innerText = `Chương ${chap.order}: ${chap.title}`;
        document.getElementById('read-chapter-content').innerHTML = chap.content;

        // Lưu vào History
        let history = DB.get('sushi_history');
        history = history.filter(h => h.storyId !== this.currentStoryId); // Xóa cũ
        history.unshift({ storyId: this.currentStoryId, chapterId: cId, timestamp: Date.now() }); // Thêm mới lên top
        DB.set('sushi_history', history);

        // Update Nav Buttons
        const idx = chaps.findIndex(x => x.id === cId);
        
        const btnPrev = document.getElementById('btn-prev-chap');
        const toolPrev = document.getElementById('tool-prev');
        const btnNext = document.getElementById('btn-next-chap');
        const toolNext = document.getElementById('tool-next');

        if(idx === 0) {
            btnPrev.className = 'btn btn-disabled'; btnPrev.onclick = null;
            toolPrev.className = 'btn btn-disabled toolbar-btn'; toolPrev.onclick = null;
        } else {
            btnPrev.className = 'btn btn-outline'; btnPrev.onclick = () => this.prevChapter();
            toolPrev.className = 'btn btn-outline toolbar-btn'; toolPrev.onclick = () => this.prevChapter();
        }

        if(idx === chaps.length - 1) {
            btnNext.className = 'btn btn-disabled'; btnNext.onclick = null;
            toolNext.className = 'btn btn-disabled toolbar-btn'; toolNext.onclick = null;
        } else {
            btnNext.className = 'btn btn-primary'; btnNext.onclick = () => this.nextChapter();
            toolNext.className = 'btn btn-outline toolbar-btn'; toolNext.onclick = () => this.nextChapter();
        }

        // Cập nhật Select Toolbar
        const select = document.getElementById('reading-chapter-select');
        select.innerHTML = '';
        chaps.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `Chương ${c.order}`;
            if(c.id === cId) opt.selected = true;
            select.appendChild(opt);
        });

        document.getElementById('reading-progress-bar').style.width = "0%";
        this.initReaderSettings();
        window.scrollTo(0, 0);
    },

    prevChapter() {
        const chaps = DB.get('sushi_chapters').filter(c => c.storyId === this.currentStoryId).sort((a,b)=>a.order - b.order);
        const idx = chaps.findIndex(x => x.id === this.currentChapterId);
        if(idx > 0) this.readChapter(chaps[idx-1].id);
    },

    nextChapter() {
        const chaps = DB.get('sushi_chapters').filter(c => c.storyId === this.currentStoryId).sort((a,b)=>a.order - b.order);
        const idx = chaps.findIndex(x => x.id === this.currentChapterId);
        if(idx < chaps.length - 1) this.readChapter(chaps[idx+1].id);
    },

    jumpToChapter(cId) {
        this.readChapter(cId);
    },

    backToStoryInfo() {
        this.readStoryInfo(this.currentStoryId);
    },

    // --- READER SETTINGS ---
    openReaderSettings() {
        document.getElementById('modal-reader-settings').classList.remove('hidden');
    },

    initReaderSettings() {
        const rSet = DB.get('sushi_reader_settings');
        document.getElementById('reader-font-family').value = rSet.font;
        document.getElementById('reader-font-size').value = rSet.size;
        document.getElementById('font-size-display').innerText = rSet.size + 'px';
        this.applyReaderSettingsFromData(rSet);
    },

    applyReaderSettings() {
        const font = document.getElementById('reader-font-family').value;
        const size = document.getElementById('reader-font-size').value;
        document.getElementById('font-size-display').innerText = size + 'px';
        
        const rSet = DB.get('sushi_reader_settings');
        rSet.font = font;
        rSet.size = size;
        DB.set('sushi_reader_settings', rSet);
        this.applyReaderSettingsFromData(rSet);
    },

    setReaderTheme(theme) {
        const rSet = DB.get('sushi_reader_settings');
        rSet.theme = theme;
        DB.set('sushi_reader_settings', rSet);
        this.applyReaderSettingsFromData(rSet);
    },

    applyReaderSettingsFromData(rSet) {
        const content = document.getElementById('read-chapter-content');
        content.style.fontFamily = rSet.font;
        content.style.fontSize = rSet.size + 'px';
        
        const wrapper = document.getElementById('reader-wrapper');
        wrapper.className = `theme-${rSet.theme}`;
    },

    // --- DATA UTILITIES ---
    exportAllData() {
        const data = {
            profile: DB.get('sushi_profile'),
            stories: DB.get('sushi_stories'),
            chapters: DB.get('sushi_chapters'),
            history: DB.get('sushi_history'),
            following: DB.get('sushi_following')
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sushi_backup_${new Date().getTime()}.json`;
        a.click();
    },

    importAllData(event) {
        const file = event.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if(data.profile && data.stories) {
                    DB.set('sushi_profile', data.profile);
                    DB.set('sushi_stories', data.stories);
                    DB.set('sushi_chapters', data.chapters || []);
                    DB.set('sushi_history', data.history || []);
                    DB.set('sushi_following', data.following || []);
                    this.toast("Nhập dữ liệu thành công! Đang tải lại...", "success");
                    setTimeout(() => location.reload(), 1000);
                } else {
                    this.toast("File không đúng định dạng!", "error");
                }
            } catch(err) {
                this.toast("Lỗi đọc file JSON.", "error");
            }
        };
        reader.readAsText(file);
    },

    downloadSingleStory(id) {
        const story = DB.get('sushi_stories').find(s => s.id === id);
        const chaps = DB.get('sushi_chapters').filter(c => c.storyId === id).sort((a,b)=>a.order - b.order);
        const data = { story, chapters: chaps };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${story.title}.json`;
        a.click();
    },

    escapeHTML(str) {
        if(!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])
        );
    }
};

document.addEventListener('DOMContentLoaded', () => { app.init(); });
