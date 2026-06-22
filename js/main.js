import { Auth } from './auth.js';
import { DB } from './db.js';
import { UI } from './ui.js';
import { Reader } from './reader.js';
import { Editor } from './editor.js';

window.app = {
    searchTimeout: null,
    currentTag: '',
    selectedTags: [],
    currentPage: 1,
    pageSize: 10,
    totalPages: 1,

    async init() {
        UI.toast('Đang khởi tạo hệ thống...', 'info');
        await Auth.init();
        
        if (!Auth.currentUser) {
            document.getElementById('modal-auth')?.classList.remove('hidden');
        } else {
            UI.updateAvatar(Auth.currentProfile);
        }

        // Lắng nghe sự kiện quay lại trang (Back/Forward)
        window.addEventListener('popstate', () => this.handleRouting());

        Reader.initScrollAndKeys();
        Reader.loadReaderSettings(); // Tải cài đặt đọc truyện lưu ở LocalStorage
        
        // Thay vì gọi showHome ngay, xử lý routing
        await this.handleRouting();
        
        // Darkmode
        const isDark = localStorage.getItem('sushi_darkmode') === 'true';
        if(isDark) {
            document.body.classList.add('dark-mode');
            document.getElementById('dark-mode-icon').className = 'ph ph-sun';
            document.getElementById('dark-mode-text').innerText = 'Giao Diện Sáng';
        }

        // Cảnh báo rời trang nếu đang viết chưa lưu
        window.addEventListener('beforeunload', (e) => {
            if (Editor.quill && Editor.currentStoryId) {
                // Kiểm tra xem có đang mở view-edit-chapter không
                const viewEdit = document.getElementById('view-edit-chapter');
                if (viewEdit && !viewEdit.classList.contains('hidden')) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            }
        });
    },

    // --- AUTH ---
    switchAuthTab(tab) {
        document.getElementById('tab-login').style.borderBottom = tab === 'login' ? '2px solid var(--primary-color)' : 'none';
        document.getElementById('tab-login').style.color = tab === 'login' ? 'var(--text-main)' : 'var(--text-muted)';
        document.getElementById('tab-register').style.borderBottom = tab === 'register' ? '2px solid var(--primary-color)' : 'none';
        document.getElementById('tab-register').style.color = tab === 'register' ? 'var(--text-main)' : 'var(--text-muted)';
        
        if (tab === 'login') {
            document.getElementById('auth-login-view').classList.remove('hidden');
            document.getElementById('auth-register-view').classList.add('hidden');
        } else {
            document.getElementById('auth-login-view').classList.add('hidden');
            document.getElementById('auth-register-view').classList.remove('hidden');
        }
    },

    async login() {
        const email = document.getElementById('auth-email').value;
        const pass = document.getElementById('auth-password').value;
        if(!email || !pass) { UI.toast('Nhập đầy đủ thông tin', 'error'); return; }
        try {
            UI.toast('Đang đăng nhập...', 'info');
            await Auth.signIn(email, pass);
            document.getElementById('modal-auth').classList.add('hidden');
            location.reload();
        } catch(e) {
            UI.toast('Sai email hoặc mật khẩu', 'error');
        }
    },

    async register() {
        const email = document.getElementById('auth-email').value;
        const pass = document.getElementById('auth-password').value;
        if(!email || !pass) { UI.toast('Nhập đầy đủ thông tin', 'error'); return; }
        if(pass.length < 6) { UI.toast('Mật khẩu tối thiểu 6 ký tự', 'error'); return; }
        try {
            UI.toast('Đang đăng ký...', 'info');
            await Auth.signUp(email, pass);
            UI.toast('Đăng ký thành công! Đang tự động đăng nhập...', 'success');
            document.getElementById('modal-auth').classList.add('hidden');
            location.reload();
        } catch(e) {
            UI.toast('Lỗi đăng ký: ' + e.message, 'error');
        }
    },

    async signOut() {
        await Auth.signOut();
    },

    // --- ROUTING ---
    async handleRouting() {
        const params = new URLSearchParams(window.location.search);
        if (params.has('chapter')) {
            const cId = params.get('chapter');
            await Reader.loadChapterDirectly(cId);
        } else if (params.has('story')) {
            const sId = params.get('story');
            this.readStoryInfo(sId, false);
        } else if (params.get('view') === 'write') {
            this.showWriteStory(false);
        } else if (params.get('view') === 'profile') {
            this.showProfileView(false);
        } else if (params.get('view') === 'my-stories') {
            this.showMyStoriesManager(false);
        } else {
            this.showHome(false);
        }
    },

    pushUrl(url) {
        if (window.location.search !== url) {
            window.history.pushState({}, '', url || '/');
        }
    },

    // --- HOME & STORIES ---
    async showHome(pushState = true) {
        UI.showView('view-home');
        if (pushState) this.pushUrl('?view=home');
        this.currentPage = 1;
        await this.renderHomeContent();
    },

    async renderHomeContent() {
        this.renderStories();
        this.renderTopFollowed();
    },

    async renderTopFollowed() {
        const topGrid = document.getElementById('top-followed-list');
        topGrid.innerHTML = Array(4).fill().map(() => `
            <div class="skeleton-card skeleton">
                <div class="skeleton-cover skeleton"></div>
                <div class="skeleton-title skeleton"></div>
                <div class="skeleton-text skeleton"></div>
            </div>
        `).join('');

        try {
            const topStories = await DB.getTopFollowedStories(10);
            topGrid.innerHTML = '';
            if(topStories.length === 0) {
                topGrid.innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Chưa có truyện nào.</p>';
                return;
            }
            topStories.forEach(s => {
                const card = document.createElement('div');
                card.className = 'story-card';
                card.onclick = () => this.readStoryInfo(s.id);
                card.innerHTML = this.buildStoryCardHtml(s);
                topGrid.appendChild(card);
            });
        } catch(e) {
            topGrid.innerHTML = '<p style="color:red; font-size:13px;">Lỗi tải Top truyện.</p>';
        }
    },

    buildStoryCardHtml(s) {
        const coverHtml = s.cover_url ? `<img src="${s.cover_url}" class="story-card-cover" loading="lazy" alt="Cover">` : `<div class="story-card-cover"></div>`;
        const tagsHtml = s.tags ? s.tags.map(t=>`<span>${t}</span>`).join('') : '';
        return `
            ${coverHtml}
            <div class="story-card-content">
                <h3>${UI.escapeHTML(s.title)}</h3>
                <div class="story-tags">${tagsHtml}</div>
                <div class="story-desc">${UI.escapeHTML(s.description || 'Chưa có mô tả.')}</div>
                <div class="story-meta">
                    <span><i class="ph ph-user"></i> <strong>${UI.escapeHTML(s.author)}</strong></span>
                    <span><i class="ph ph-list-numbers"></i> ${s.chaptersCount} chương</span>
                </div>
            </div>
        `;
    },

    handleSearchDebounced(e) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            this.renderStories();
        }, 250);
    },

    async filterByTag(tag) {
        this.currentTag = tag;
        this.currentPage = 1;
        document.querySelectorAll('#home-tags .tag-pill').forEach(el => {
            el.classList.remove('active');
            if(el.innerText === tag || (tag === '' && el.innerText === 'Tất cả')) el.classList.add('active');
        });
        await this.renderStories();
    },

    changePage(delta) {
        let newPage = this.currentPage + delta;
        if(newPage < 1) newPage = 1;
        if(newPage > this.totalPages) newPage = this.totalPages;
        if(newPage !== this.currentPage) {
            this.currentPage = newPage;
            this.renderStories();
            document.getElementById('latest-stories-section').scrollIntoView({ behavior: 'smooth' });
        }
    },

    async renderStories() {
        const term = document.getElementById('search-input').value.trim();
        const grid = document.getElementById('stories-list');
        
        // Render Skeleton Loading
        grid.innerHTML = Array(6).fill().map(() => `
            <div class="skeleton-card skeleton">
                <div class="skeleton-cover skeleton"></div>
                <div class="skeleton-title skeleton"></div>
                <div class="skeleton-text skeleton"></div>
                <div class="skeleton-text skeleton short"></div>
            </div>
        `).join('');

        try {
            const result = await DB.getStories(this.currentTag, term, this.currentPage, this.pageSize);
            const stories = result.data;
            this.totalPages = Math.ceil(result.count / this.pageSize) || 1;
            
            grid.innerHTML = '';
            
            if(stories.length === 0) {
                grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-books"></i>
                    <p>Không tìm thấy truyện nào.</p>
                </div>`; 
                document.getElementById('pagination-controls').style.display = 'none';
                return;
            }

            document.getElementById('pagination-controls').style.display = 'flex';
            document.getElementById('page-indicator').innerText = `Trang ${this.currentPage} / ${this.totalPages}`;
            document.getElementById('btn-page-prev').disabled = this.currentPage === 1;
            document.getElementById('btn-page-next').disabled = this.currentPage === this.totalPages;

            stories.forEach(s => {
                const card = document.createElement('div');
                card.className = 'story-card';
                card.onclick = () => this.readStoryInfo(s.id);
                card.innerHTML = this.buildStoryCardHtml(s);
                grid.appendChild(card);
            });

            // ----------------- RECOMMENDATIONS (DÀNH RIÊNG CHO BẠN) -----------------
            const recSection = document.getElementById('recommendation-section');
            if(Auth.currentUser && !term && !this.currentTag && this.currentPage === 1) {
                const history = await DB.getHistory();
                if(history.length > 0 && history[0].stories && history[0].stories.tags && history[0].stories.tags.length > 0) {
                    const latestStory = history[0].stories;
                    const tagToMatch = latestStory.tags[0]; // Lấy tag đầu tiên của bộ truyện vừa đọc
                    
                    // Lấy tất cả truyện có tag này (không phân trang cho gợi ý)
                    const recResult = await DB.getStories(tagToMatch, '', 1, 4);
                    const recStories = recResult.data.filter(s => s.id !== latestStory.id);
                    
                    if(recStories.length > 0) {
                        document.getElementById('recommend-tag-name').innerText = tagToMatch;
                        const recGrid = document.getElementById('recommend-stories-list');
                        recGrid.innerHTML = '';
                        recStories.forEach(s => {
                            const card = document.createElement('div');
                            card.className = 'story-card';
                            card.onclick = () => this.readStoryInfo(s.id);
                            card.innerHTML = this.buildStoryCardHtml(s);
                            recGrid.appendChild(card);
                        });
                        recSection.classList.remove('hidden');
                    } else {
                        recSection.classList.add('hidden');
                    }
                } else {
                    recSection.classList.add('hidden');
                }
            } else {
                if(recSection) recSection.classList.add('hidden');
            }

        } catch(e) {
            console.error(e);
            grid.innerHTML = '<p style="color:red; grid-column:1/-1;">Lỗi tải dữ liệu. Cấu hình Supabase chưa đúng hoặc Lỗi mạng.</p>';
        }
    },

    async showMyStoriesManager(pushState = true) {
        UI.showView('view-my-stories');
        if (pushState) this.pushUrl('?view=my-stories');
        const grid = document.getElementById('my-stories-grid');
        grid.innerHTML = '<p>Đang tải...</p>';
        
        try {
            const stories = await DB.getMyStories();
            grid.innerHTML = '';
            
            if(stories.length === 0) {
                grid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ph ph-books"></i>
                        <p>Bạn chưa có truyện nào trên hệ thống Cloud. Hãy bắt đầu hành trình sáng tác!</p>
                        <button class="btn btn-primary" onclick="app.showWriteStory()"><i class="ph ph-pencil-simple"></i> Viết Truyện Ngay</button>
                    </div>`;
                return;
            }

            stories.forEach(s => {
                const card = document.createElement('div');
                card.className = 'story-card';
                const coverHtml = s.cover_url ? `<img src="${s.cover_url}" class="story-card-cover" loading="lazy">` : `<div class="story-card-cover"></div>`;
                card.innerHTML = `
                    ${coverHtml}
                    <div class="story-card-content">
                        <h3>${UI.escapeHTML(s.title)}</h3>
                        <div class="story-desc">${UI.escapeHTML(s.description || '')}</div>
                        <div class="story-meta"><span>${s.chaptersCount} chương</span></div>
                    </div>
                    <div class="gear-icon" title="Chỉnh sửa truyện" onclick="app.editStory('${s.id}')">
                        <i class="ph ph-gear"></i>
                    </div>
                `;
                grid.appendChild(card);
            });
        } catch(e) {
            console.error(e);
            UI.toast('Lỗi tải truyện cá nhân', 'error');
        }
    },

    // --- PROXY METHODS TO MODULES ---
    toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('sushi_darkmode', isDark);
        document.getElementById('dark-mode-icon').className = isDark ? 'ph ph-sun' : 'ph ph-moon';
        document.getElementById('dark-mode-text').innerText = isDark ? 'Giao Diện Sáng' : 'Giao Diện Tối';
        UI.toast('Đã thay đổi giao diện', 'info');
    },

    toggleDropdown() { document.getElementById('avatar-dropdown').classList.toggle('show'); },
    
    // Auth & Profile
    showProfileView(pushState = true) {
        UI.showView('view-profile');
        if (pushState) this.pushUrl('?view=profile');
        if(Auth.currentProfile) {
            document.getElementById('profile-penname').value = Auth.currentProfile.pen_name || '';
            document.getElementById('profile-bio').value = Auth.currentProfile.bio || '';
            Editor.tempAvatarBase64 = Auth.currentProfile.avatar_url || '';
            const preview = document.getElementById('profile-avatar-preview');
            if(Editor.tempAvatarBase64) {
                preview.style.backgroundImage = `url(${Editor.tempAvatarBase64})`;
                preview.innerText = '';
            }
        }
    },
    async saveProfile() {
        const name = document.getElementById('profile-penname').value.trim();
        const bio = document.getElementById('profile-bio').value.trim();
        UI.toast('Đang lưu hồ sơ...', 'info');
        try {
            await DB.updateProfile(name, bio, Editor.tempAvatarBase64);
            UI.updateAvatar(Auth.currentProfile);
            UI.toast('Lưu hồ sơ thành công!', 'success');
        } catch(e) { UI.toast('Lỗi lưu hồ sơ', 'error'); console.error(e); }
    },

    // Modals
    closeModals() { UI.closeModals(); },
    async openHistoryModal() {
        UI.closeModals();
        document.getElementById('avatar-dropdown').classList.remove('show');
        try {
            const h = await DB.getHistory();
            this.renderListInModal('history-list', h, 'Chưa có lịch sử đọc.', true);
            document.getElementById('modal-history').classList.remove('hidden');
        } catch(e) { UI.toast('Lỗi tải lịch sử', 'error'); }
    },
    async openFollowingModal() {
        UI.closeModals();
        document.getElementById('avatar-dropdown').classList.remove('show');
        try {
            const f = await DB.getFollows();
            this.renderListInModal('following-list', f, 'Bạn chưa theo dõi truyện nào.', false);
            document.getElementById('modal-following').classList.remove('hidden');
        } catch(e) { UI.toast('Lỗi tải danh sách', 'error'); }
    },
    renderListInModal(containerId, dataArr, emptyMsg, isHistory) {
        const list = document.getElementById(containerId);
        list.innerHTML = '';
        if(dataArr.length === 0) { 
            list.innerHTML = `<div class="empty-state"><i class="ph ph-ghost"></i><p>${emptyMsg}</p></div>`; 
            return; 
        }
        dataArr.forEach(item => {
            if(!item.stories) return;
            const div = document.createElement('div');
            div.className = 'chapter-item';
            let chapterInfo = '';
            if(isHistory && item.last_chapter_id && item.chapters) {
                chapterInfo = `<br><small style="color:var(--primary-color);">Đang đọc: Chương ${item.chapters.chapter_order}</small>`;
            }
            div.innerHTML = `
                <div style="flex:1;"><strong>${UI.escapeHTML(item.stories.title)}</strong>${chapterInfo}</div>
                <button class="btn btn-outline" onclick="app.readStoryInfo('${item.stories.id}')">Chi tiết</button>
            `;
            list.appendChild(div);
        });
    },

    // Reading
    readStoryInfo(id) { Reader.readStoryInfo(id); },
    continueReading() { Reader.readChapter(Reader.currentChapterId || Reader.chapsCache[0]?.id); },
    async toggleFollow() {
        if(!Auth.currentUser) { UI.toast('Đăng nhập để theo dõi', 'error'); return; }
        const isFollowed = await DB.toggleFollow(Reader.currentStoryId);
        const btnF = document.getElementById('btn-follow');
        if(isFollowed) {
            UI.toast('Đã thêm vào Theo dõi', 'success');
            btnF.innerHTML = '<i class="ph ph-heart-break"></i> Bỏ theo dõi'; 
            btnF.classList.replace('btn-primary', 'btn-outline'); 
        } else {
            UI.toast('Đã bỏ theo dõi');
            btnF.innerHTML = '<i class="ph ph-heart"></i> Theo dõi'; 
            btnF.classList.replace('btn-outline', 'btn-primary'); 
        }
    },
    readChapter(cId) { Reader.readChapter(cId); },
    prevChapter() { Reader.prevChapter(); },
    nextChapter() { Reader.nextChapter(); },
    jumpToChapter(cId) { Reader.readChapter(cId); },
    backToStoryInfo() { Reader.readStoryInfo(Reader.currentStoryId); },
    toggleTTS() { Reader.toggleTTS(); },
    openReaderSettings() { document.getElementById('modal-reader-settings').classList.remove('hidden'); },
    applyReaderSettings() { Reader.applyReaderSettings(); },
    setReaderTheme(t) { Reader.setReaderTheme(t); },
    applyTTSSettings() { Reader.applyTTSSettings(); },

    // Comments
    async postComment(storyId, chapterId, prefix) {
        const input = document.getElementById(`${prefix}-comment-input`);
        const content = input.value.trim();
        if (!content) return;

        const btn = input.nextElementSibling;
        btn.disabled = true;
        btn.innerText = 'Đang gửi...';

        try {
            await DB.addComment(storyId, chapterId || null, content);
            input.value = '';
            UI.toast('Đã gửi bình luận', 'success');
            Reader.renderComments(storyId, chapterId || null);
        } catch(e) {
            console.error(e);
            UI.toast('Lỗi gửi bình luận', 'error');
        } finally {
            btn.disabled = false;
            btn.innerText = 'Gửi Bình Luận';
        }
    },

    // Editor & Cropper
    showWriteStory(pushState = true) {
        UI.showView('view-write');
        if (pushState) this.pushUrl('?view=write');
        document.getElementById('write-title-heading').innerText = 'Tạo Bộ Truyện Mới';
        document.getElementById('edit-story-id').value = '';
        document.getElementById('story-title').value = '';
        document.getElementById('story-desc').value = '';
        
        this.selectedTags = [];
        this.renderSelectedTags();

        Editor.tempCoverBase64 = '';
        document.getElementById('story-cover-preview').style.display = 'none';
        document.getElementById('btn-remove-cover').classList.add('hidden');
        document.getElementById('btn-add-chapter').classList.add('hidden');
        document.getElementById('btn-delete-story').classList.add('hidden');
        document.getElementById('edit-chapter-list').classList.add('hidden');
        document.getElementById('story-analytics-section').classList.add('hidden');
        Editor.currentStoryId = null;
    },
    async editStory(id) {
        try {
            const story = await DB.getStory(id);
            UI.showView('view-write');
            document.getElementById('write-title-heading').innerText = 'Chỉnh Sửa Bộ Truyện';
            document.getElementById('edit-story-id').value = story.id;
            document.getElementById('story-title').value = story.title;
            document.getElementById('story-desc').value = story.description || '';
            
            this.selectedTags = story.tags || [];
            this.renderSelectedTags();

            document.getElementById('story-status').value = story.is_published !== false ? "true" : "false";
            
            if(story.cover_url) {
                Editor.tempCoverBase64 = story.cover_url;
                const img = document.getElementById('story-cover-preview');
                img.src = story.cover_url;
                img.style.display = 'block';
                document.getElementById('btn-remove-cover').classList.remove('hidden');
            }
            document.getElementById('btn-add-chapter').classList.remove('hidden');
            document.getElementById('btn-delete-story').classList.remove('hidden');
            document.getElementById('edit-chapter-list').classList.remove('hidden');
            
            Editor.currentStoryId = story.id;

            // Load Analytics
            const analytics = await DB.getStoryAnalytics(story.id);
            if (analytics) {
                document.getElementById('story-analytics-section').classList.remove('hidden');
                document.getElementById('stat-total-reads').innerText = analytics.total_reads || 0;
                document.getElementById('stat-avg-time').innerText = (analytics.avg_time_spent || 0) + 's';
                document.getElementById('stat-avg-scroll').innerText = (analytics.avg_scroll || 0) + '%';
            } else {
                document.getElementById('story-analytics-section').classList.add('hidden');
            }
            
            // Render chapters (isAuthor = true)
            const chaps = await DB.getChapters(story.id, true);
            const container = document.getElementById('chapters-container');
            container.innerHTML = '';
            if(chaps.length === 0) container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Chưa có chương nào.</p>';
            chaps.forEach(c => {
                const d = document.createElement('div');
                d.className = 'chapter-item';
                const draftBadge = c.is_published === false ? '<span style="font-size:11px;background:#ef4444;padding:2px 6px;border-radius:4px;margin-left:8px;">Bản Nháp</span>' : '';
                d.innerHTML = `<span>${c.chapter_order}. ${UI.escapeHTML(c.title)}${draftBadge}</span> <button class="btn btn-outline" onclick="app.openChapterEditor('${c.id}')"><i class="ph ph-pencil-simple"></i> Sửa</button>`;
                container.appendChild(d);
            });
        } catch(e) { UI.toast('Lỗi tải truyện', 'error'); }
    },
    saveStoryMetadata() { Editor.saveStoryMetadata(); },
    async promptDeleteStory() {
        if(!Editor.currentStoryId) return;
        UI.confirm("Bạn có chắc chắn muốn xóa vĩnh viễn bộ truyện này không? Không thể khôi phục!", async () => {
            try {
                await DB.deleteStory(Editor.currentStoryId);
                UI.toast('Đã xóa truyện', 'success');
                this.showMyStoriesManager();
            } catch(e) { UI.toast('Lỗi khi xóa', 'error'); }
        });
    },
    async openChapterEditor(cId = null) {
        UI.showView('view-edit-chapter');
        Editor.initQuill();
        if(cId) {
            const chaps = await DB.getChapters(Editor.currentStoryId, true);
            const c = chaps.find(x => x.id === cId);
            document.getElementById('editing-chapter-id').value = c.id;
            document.getElementById('chapter-title').value = c.title;
            document.getElementById('chapter-status').value = c.is_published !== false ? "true" : "false";
            Editor.quill.root.innerHTML = c.content;
            
            const draftKey = `sushi_draft_${Editor.currentStoryId}_${c.id}`;
            const draft = localStorage.getItem(draftKey);
            if(draft && draft !== c.content) {
                UI.confirm("Bạn có một bản nháp chưa lưu cho chương này. Bạn có muốn khôi phục không?", () => {
                    Editor.quill.root.innerHTML = draft;
                    Editor.updateWordCount();
                });
            } else {
                Editor.updateWordCount();
            }
        } else {
            document.getElementById('editing-chapter-id').value = '';
            document.getElementById('chapter-title').value = '';
            document.getElementById('chapter-status').value = "true";
            
            // Auto-restore draft if exists
            const draftKey = `sushi_draft_${Editor.currentStoryId}_new`;
            const draft = localStorage.getItem(draftKey);
            if(draft) {
                UI.confirm("Bạn có một bản nháp chưa lưu cho chương mới. Bạn có muốn khôi phục không?", () => {
                    Editor.quill.root.innerHTML = draft;
                    Editor.updateWordCount();
                });
            } else {
                Editor.quill.root.innerHTML = '';
                Editor.updateWordCount();
            }
        }
        
        // Reset focus mode & save status
        document.body.classList.remove('focus-mode-active');
        document.getElementById('editor-save-status').innerText = '';
    },
    
    toggleFocusMode() {
        document.body.classList.toggle('focus-mode-active');
    },

    closeChapterEditor() { this.editStory(Editor.currentStoryId); },
    saveChapter() { Editor.saveChapter(); },
    openCropper(e, t) { Editor.openCropper(e, t); },
    closeCropperModal() { Editor.closeCropperModal(); },
    confirmCrop() { Editor.confirmCrop(); },
    removeCover() {
        Editor.tempCoverBase64 = '';
        document.getElementById('story-cover-preview').style.display = 'none';
        document.getElementById('btn-remove-cover').classList.add('hidden');
        document.getElementById('story-cover-upload').value = '';
    },
    closeConfirmModal() { UI.closeConfirmModal(); },

    // TAG LOGIC
    toggleStoryTag(tag) {
        if (this.selectedTags.includes(tag)) {
            this.selectedTags = this.selectedTags.filter(t => t !== tag);
        } else {
            this.selectedTags.push(tag);
        }
        this.renderSelectedTags();
    },
    addCustomStoryTag() {
        const input = document.getElementById('custom-tag-input');
        const val = input.value.trim();
        if (val && !this.selectedTags.includes(val)) {
            this.selectedTags.push(val);
        }
        input.value = '';
        document.getElementById('custom-tag-input-container').classList.add('hidden');
        this.renderSelectedTags();
    },
    renderSelectedTags() {
        const container = document.getElementById('selected-tags-container');
        const msg = document.getElementById('no-tags-msg');
        
        if (this.selectedTags.length === 0) {
            container.innerHTML = '<span style="color:var(--text-muted); font-size: 13px; margin:auto;" id="no-tags-msg">Chưa có tag nào</span>';
        } else {
            container.innerHTML = this.selectedTags.map(t => 
                `<span style="background: var(--primary-color); color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 12px; display:inline-flex; align-items:center; gap:5px;">
                    ${UI.escapeHTML(t)} 
                    <i class="ph ph-x" style="cursor:pointer;" onclick="app.toggleStoryTag('${t.replace(/'/g, "\\'")}')"></i>
                </span>`
            ).join('');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => { window.app.init(); });
