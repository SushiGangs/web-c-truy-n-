import { UI } from './ui.js';
import { DB } from './db.js';

export const Reader = {
    currentStoryId: null,
    currentChapterId: null,
    chapsCache: [],
    lastScrollY: 0,
    synth: window.speechSynthesis,
    utterance: null,

    // Analytics State
    readingStartTime: 0,
    maxScrollPercentage: 0,
    currentParagraphIndex: 0,
    observer: null,
    historyDebounceTimer: null,
    lastHistoryObj: null,

    initScrollAndKeys() {
        window.addEventListener('beforeunload', () => {
            this.finishReadingEvent();
        });
        window.addEventListener('scroll', () => {
            const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = height > 0 ? (winScroll / height) * 100 : 0;
            const bar = document.getElementById('reading-progress-bar');
            if(bar) bar.style.width = scrolled + "%";
            
            if(this.currentChapterId) {
                this.maxScrollPercentage = Math.max(this.maxScrollPercentage || 0, scrolled);
            }

            // Toolbar hiding logic
            const toolbar = document.getElementById('reading-toolbar');
            const viewRead = document.getElementById('view-read-chapter');
            if(toolbar && viewRead && !viewRead.classList.contains('hidden')) {
                if(winScroll > this.lastScrollY && winScroll > 100) {
                    toolbar.classList.add('hidden-scroll');
                } else {
                    toolbar.classList.remove('hidden-scroll');
                }
            }
            this.lastScrollY = winScroll;
        });

        document.addEventListener('click', (e) => {
            const viewRead = document.getElementById('view-read-chapter');
            if(viewRead && !viewRead.classList.contains('hidden')) {
                const toolbar = document.getElementById('reading-toolbar');
                if(toolbar && !e.target.closest('#reading-toolbar') && !e.target.closest('.read-header') && !e.target.closest('.btn')) {
                    toolbar.classList.remove('hidden-scroll');
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            const viewRead = document.getElementById('view-read-chapter');
            if(viewRead && !viewRead.classList.contains('hidden') && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                if(e.key === 'ArrowRight') {
                    const btn = document.getElementById('tool-next');
                    if(btn && !btn.classList.contains('btn-disabled')) this.nextChapter();
                }
                if(e.key === 'ArrowLeft') {
                    const btn = document.getElementById('tool-prev');
                    if(btn && !btn.classList.contains('btn-disabled')) this.prevChapter();
                }
            }
        });
    },

    async readStoryInfo(id, pushState = true) {
        UI.showView('view-read-info');
        if (pushState && window.app) window.app.pushUrl(`?story=${id}`);
        UI.toast('Đang tải thông tin truyện...', 'info');
        
        try {
            const story = await DB.getStory(id);
            if(!story) { UI.toast('Truyện không tồn tại', 'error'); return; }

            this.currentStoryId = id;
            document.getElementById('info-title').innerText = story.title;
            document.getElementById('info-author').innerText = story.author;
            document.getElementById('info-desc').innerText = story.description || 'Chưa có mô tả.';
            
            const coverImg = document.getElementById('info-cover');
            if(story.cover_url) {
                coverImg.src = story.cover_url;
                coverImg.style.display = 'block';
            } else {
                coverImg.style.display = 'none';
            }

            const tagsHtml = story.tags ? story.tags.map(t=>`<span class="tag-pill" style="font-size:12px;">${t}</span>`).join('') : '';
            document.getElementById('info-tags').innerHTML = tagsHtml;

            // Follow
            const isFollowing = await DB.checkFollow(id);
            const btnF = document.getElementById('btn-follow');
            if(isFollowing) { 
                btnF.innerHTML = '<i class="ph ph-heart-break"></i> Bỏ theo dõi'; 
                btnF.classList.replace('btn-primary', 'btn-outline'); 
            } else { 
                btnF.innerHTML = '<i class="ph ph-heart"></i> Theo dõi'; 
                btnF.classList.replace('btn-outline', 'btn-primary'); 
            }

            // Chapters
            const chaps = await DB.getChapters(id);
            this.chapsCache = chaps;
            
            // History
            let lastChapId = null;
            const history = await DB.getHistory();
            const hItem = history.find(h => h.story_id === id);
            this.lastHistoryObj = hItem || null;
            if(hItem) lastChapId = hItem.last_chapter_id;

            const btnContinue = document.getElementById('btn-continue-read');
            if(lastChapId && chaps.length > 0) {
                const chap = chaps.find(x => x.id === lastChapId);
                if(chap) {
                    btnContinue.classList.remove('hidden');
                    document.getElementById('continue-read-text').innerText = `Đọc tiếp Chương ${chap.chapter_order}`;
                    btnContinue.onclick = () => this.readChapter(lastChapId);
                } else {
                    btnContinue.classList.add('hidden');
                }
            } else {
                btnContinue.classList.add('hidden');
            }

            // Lấy danh sách chapter đã đọc
            const readChapters = await DB.getReadChapters(id);
            const now = Date.now();
            const oneDayMs = 24 * 60 * 60 * 1000;

            const cList = document.getElementById('read-chapter-list');
            cList.innerHTML = '';
            if(chaps.length===0) cList.innerHTML = '<p style="color:var(--text-muted)">Truyện chưa có chương.</p>';
            
            chaps.forEach(c => {
                const isRead = readChapters.includes(c.id);
                const isNew = (!isRead && c.created_at && (now - new Date(c.created_at).getTime() < oneDayMs));

                const d = document.createElement('button');
                d.className = `chapter-item ${isRead ? 'chapter-read' : 'chapter-unread'}`;
                if(lastChapId === c.id) d.style.borderColor = "var(--primary-color)";
                
                let titleHtml = `<span>Chương ${c.chapter_order}: ${UI.escapeHTML(c.title)}${isNew ? '<span class="badge-new">NEW</span>' : ''}</span>`;
                let actionHtml = `<span style="font-size:12px; color:var(--primary-color); flex-shrink: 0; white-space:nowrap;">Đọc <i class="ph ph-caret-right"></i></span>`;
                
                d.innerHTML = `${titleHtml} ${actionHtml}`;
                d.onclick = () => this.readChapter(c.id);
                cList.appendChild(d);
            });

            // Load Comments for Story
            this.renderComments(id, null);

        } catch(e) {
            UI.toast('Lỗi khi tải truyện', 'error');
            console.error(e);
        }
    },

    async readChapter(cId, pushState = true) {
        if(this.synth.speaking) this.synth.cancel(); // Stop TTS if switching
        this.finishReadingEvent(); // Lưu event của chương cũ nếu có

        UI.showView('view-read-chapter');
        if (pushState && window.app) window.app.pushUrl(`?chapter=${cId}`);
        const chap = this.chapsCache.find(x => x.id === cId);
        if(!chap) return;

        this.currentChapterId = cId;
        document.getElementById('read-chapter-title').innerText = `Chương ${chap.chapter_order}: ${chap.title}`;
        
        // Sử dụng DOMPurify để sanitize content, chống XSS
        const cleanContent = window.DOMPurify ? window.DOMPurify.sanitize(chap.content) : chap.content;
        document.getElementById('read-chapter-content').innerHTML = cleanContent;

        // ----------------- INTERSECTION OBSERVER & ANALYTICS -----------------
        this.readingStartTime = Date.now();
        this.maxScrollPercentage = 0;
        this.currentParagraphIndex = 0;

        const pTags = document.querySelectorAll('#read-chapter-content p');
        pTags.forEach((p, i) => { p.dataset.index = i; });

        if(this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if(entry.isIntersecting) {
                    const idx = parseInt(entry.target.dataset.index);
                    this.currentParagraphIndex = Math.max(this.currentParagraphIndex, idx);
                    this.scheduleHistorySave();
                }
            });
        }, { rootMargin: '-10% 0px -40% 0px', threshold: 0.1 }); 

        pTags.forEach(p => this.observer.observe(p));

        // Tự động cuộn đến vị trí cũ nếu là chương đang đọc dở
        if (this.lastHistoryObj && this.lastHistoryObj.last_chapter_id === cId) {
            const targetIdx = this.lastHistoryObj.last_paragraph_index || 0;
            if (pTags[targetIdx]) {
                setTimeout(() => pTags[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
            }
        }
        // ---------------------------------------------------------------------

        // Calc reading time
        const wordCount = chap.content.replace(/<[^>]*>?/gm, '').split(/\s+/).length;
        const readTime = Math.ceil(wordCount / 200);
        
        let estTimeEl = document.getElementById('est-read-time');
        if(!estTimeEl) {
            estTimeEl = document.createElement('p');
            estTimeEl.id = 'est-read-time';
            estTimeEl.style.fontSize = '13px';
            estTimeEl.style.color = 'var(--text-muted)';
            estTimeEl.style.marginTop = '10px';
            document.querySelector('.read-header').appendChild(estTimeEl);
        }
        estTimeEl.innerHTML = `<i class="ph ph-clock"></i> Thời gian đọc: ~${readTime} phút`;

        // Save History (gọi ban đầu để lưu chương, paragraph sẽ update qua observer)
        this.scheduleHistorySave();

        // Update Nav
        const idx = this.chapsCache.findIndex(x => x.id === cId);
        const btnPrev = document.getElementById('btn-prev-chap');
        const toolPrev = document.getElementById('tool-prev');
        const btnNext = document.getElementById('btn-next-chap');
        const toolNext = document.getElementById('tool-next');

        const disableBtn = (el) => { if(el){ el.classList.add('btn-disabled'); el.onclick = null; } };
        const enableBtn = (el, fn) => { if(el){ el.classList.remove('btn-disabled'); el.onclick = fn; } };

        if(idx === 0) { disableBtn(btnPrev); disableBtn(toolPrev); } 
        else { enableBtn(btnPrev, () => this.prevChapter()); enableBtn(toolPrev, () => this.prevChapter()); }

        if(idx === this.chapsCache.length - 1) { disableBtn(btnNext); disableBtn(toolNext); } 
        else { enableBtn(btnNext, () => this.nextChapter()); enableBtn(toolNext, () => this.nextChapter()); }

        // Update Select
        const select = document.getElementById('reading-chapter-select');
        if(select) {
            select.innerHTML = '';
            this.chapsCache.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.innerText = `Chương ${c.chapter_order}`;
                if(c.id === cId) opt.selected = true;
                select.appendChild(opt);
            });
        }

        // Load Comments for Chapter
        this.renderComments(this.currentStoryId, cId);

        window.scrollTo(0, 0);
    },

    finishReadingEvent() {
        if (!this.currentChapterId || !this.readingStartTime) return;
        const timeSpent = Math.floor((Date.now() - this.readingStartTime) / 1000);
        if (timeSpent > 5) { 
            DB.saveReadingEvent(this.currentStoryId, this.currentChapterId, this.maxScrollPercentage, timeSpent);
        }
        this.readingStartTime = 0;
        this.maxScrollPercentage = 0;
    },

    scheduleHistorySave() {
        if(this.historyDebounceTimer) clearTimeout(this.historyDebounceTimer);
        this.historyDebounceTimer = setTimeout(() => {
            if(this.currentStoryId && this.currentChapterId) {
                DB.saveHistory(this.currentStoryId, this.currentChapterId, this.currentParagraphIndex, this.maxScrollPercentage);
            }
        }, 3000);
    },

    prevChapter() {
        const idx = this.chapsCache.findIndex(x => x.id === this.currentChapterId);
        if(idx > 0) this.readChapter(this.chapsCache[idx-1].id);
    },

    nextChapter() {
        const idx = this.chapsCache.findIndex(x => x.id === this.currentChapterId);
        if(idx < this.chapsCache.length - 1) this.readChapter(this.chapsCache[idx+1].id);
    },

    // --- TEXT TO SPEECH ---
    populateTTSVoices() {
        let voices = this.synth.getVoices();
        const voiceSelect = document.getElementById('tts-voice');
        if (!voiceSelect) return;
        
        if (voices.length === 0) {
            this.synth.onvoiceschanged = () => {
                this.populateTTSVoices();
            };
            return;
        }

        const savedVoice = localStorage.getItem('sushi_tts_voice');
        voiceSelect.innerHTML = '<option value="">Mặc định hệ thống</option>';
        
        voices.forEach((v, i) => {
            // Chỉ hiện các giọng hỗ trợ tiếng Việt hoặc tiếng Anh (để dự phòng)
            if (v.lang.startsWith('vi') || v.lang.startsWith('en')) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `${v.name} (${v.lang})`;
                if (savedVoice === i.toString()) opt.selected = true;
                voiceSelect.appendChild(opt);
            }
        });
    },

    applyTTSSettings() {
        const speed = document.getElementById('tts-speed').value;
        const voiceIndex = document.getElementById('tts-voice').value;
        
        document.getElementById('tts-speed-display').innerText = speed + 'x';
        
        localStorage.setItem('sushi_tts_speed', speed);
        localStorage.setItem('sushi_tts_voice', voiceIndex);
    },

    toggleTTS() {
        if (this.synth.speaking) {
            this.synth.cancel();
            UI.toast('Đã dừng Đọc Truyện');
            return;
        }
        
        const text = document.getElementById('read-chapter-content').innerText;
        if(!text) return;
        
        this.utterance = new SpeechSynthesisUtterance(text);
        
        // Apply Settings
        const speed = localStorage.getItem('sushi_tts_speed') || 1.0;
        this.utterance.rate = parseFloat(speed);
        
        const voiceIndex = localStorage.getItem('sushi_tts_voice');
        if (voiceIndex) {
            const voices = this.synth.getVoices();
            if (voices[voiceIndex]) {
                this.utterance.voice = voices[voiceIndex];
            }
        } else {
            this.utterance.lang = 'vi-VN';
        }

        this.synth.speak(this.utterance);
        UI.toast('Đang đọc truyện...', 'info');
    },

    // --- DIRECT LOAD ---
    async loadChapterDirectly(cId) {
        try {
            UI.toast('Đang tải chương...', 'info');
            // Cần lấy story_id của chapter này
            const { data, error } = await DB.supabase.from('chapters').select('story_id').eq('id', cId).single();
            if(error || !data) throw error;
            
            await this.readStoryInfo(data.story_id, false); // Load thông tin truyện để lấy cache
            await this.readChapter(cId, false); // Đọc chương
        } catch(e) {
            console.error(e);
            UI.toast('Lỗi tải chương', 'error');
            if(window.app) window.app.showHome();
        }
    },

    // --- COMMENTS ---
    async renderComments(storyId, chapterId) {
        const isChapter = !!chapterId;
        const prefix = isChapter ? 'chapter' : 'story';
        const formContainer = document.getElementById(`${prefix}-comment-form-container`);
        const listContainer = document.getElementById(`${prefix}-comments-list`);
        
        if (!formContainer || !listContainer) return;

        // Render Form
        import('./auth.js').then(({ Auth }) => {
            if (Auth.currentUser) {
                formContainer.innerHTML = `
                    <div style="display: flex; gap: 10px; align-items: flex-start;">
                        <div class="avatar" style="width: 40px; height: 40px; font-size: 16px; background-image: url(${Auth.currentProfile?.avatar_url || ''});">
                            ${!Auth.currentProfile?.avatar_url ? (Auth.currentProfile?.pen_name ? Auth.currentProfile.pen_name.charAt(0).toUpperCase() : 'U') : ''}
                        </div>
                        <div style="flex: 1;">
                            <textarea id="${prefix}-comment-input" rows="2" placeholder="Viết bình luận của bạn..." style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid var(--border-light); background: var(--input-bg); color: var(--text-main); font-family: 'Inter', sans-serif; resize: vertical;"></textarea>
                            <button class="btn btn-primary" style="margin-top: 8px; padding: 6px 15px; font-size: 13px;" onclick="window.app.postComment('${storyId}', '${chapterId || ''}', '${prefix}')">Gửi Bình Luận</button>
                        </div>
                    </div>
                `;
            } else {
                formContainer.innerHTML = `<div style="padding: 15px; background: rgba(128,128,128,0.1); border-radius: 8px; text-align: center; color: var(--text-muted); font-size: 14px;">Vui lòng <a href="#" style="color: var(--primary-color); font-weight: bold;" onclick="document.getElementById('modal-auth').classList.remove('hidden'); return false;">Đăng nhập</a> để bình luận.</div>`;
            }
        });

        // Render List
        listContainer.innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">Đang tải bình luận...</p>';
        try {
            const comments = await DB.getComments(storyId, chapterId);
            listContainer.innerHTML = '';
            if (comments.length === 0) {
                listContainer.innerHTML = '<p style="color:var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Chưa có bình luận nào. Hãy là người đầu tiên!</p>';
                return;
            }

            comments.forEach(c => {
                const d = document.createElement('div');
                d.style.cssText = "display: flex; gap: 15px; background: var(--block-bg); padding: 15px; border-radius: 12px; border: 1px solid var(--block-border);";
                
                const avatar = c.profiles?.avatar_url ? `<div class="avatar" style="width: 40px; height: 40px; font-size: 16px; background-image: url(${c.profiles.avatar_url}); flex-shrink: 0;"></div>` : `<div class="avatar" style="width: 40px; height: 40px; font-size: 16px; flex-shrink: 0;">${c.profiles?.pen_name ? c.profiles.pen_name.charAt(0).toUpperCase() : 'U'}</div>`;
                
                const timeStr = new Date(c.created_at).toLocaleString('vi-VN');
                
                d.innerHTML = `
                    ${avatar}
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items:baseline; margin-bottom: 5px;">
                            <strong style="font-size: 14px; color: var(--primary-color);">${UI.escapeHTML(c.profiles?.pen_name || 'Vô danh')}</strong>
                            <span style="font-size: 11px; color: var(--text-muted);">${timeStr}</span>
                        </div>
                        <div style="font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${UI.escapeHTML(c.content)}</div>
                    </div>
                `;
                listContainer.appendChild(d);
            });
        } catch(e) {
            console.error(e);
            listContainer.innerHTML = '<p style="color:red; font-size: 13px;">Lỗi tải bình luận.</p>';
        }
    },

    // --- READER SETTINGS ---
    applyReaderSettings() {
        const font = document.getElementById('reader-font-family').value;
        const size = document.getElementById('reader-font-size').value;
        const lineHeight = document.getElementById('reader-line-height').value;
        
        const content = document.getElementById('read-chapter-content');
        if (content) {
            content.style.fontFamily = font;
            content.style.fontSize = size + 'px';
            content.style.lineHeight = lineHeight;
        }
        document.getElementById('font-size-display').innerText = size + 'px';
        const lhDisplay = document.getElementById('line-height-display');
        if (lhDisplay) lhDisplay.innerText = lineHeight;

        // Save to localStorage
        localStorage.setItem('sushi_reader_font', font);
        localStorage.setItem('sushi_reader_size', size);
        localStorage.setItem('sushi_reader_lineheight', lineHeight);
    },

    setReaderTheme(theme) {
        const wrapper = document.getElementById('reader-wrapper');
        if (wrapper) {
            wrapper.className = `theme-${theme}`;
        }
        // Save to localStorage
        localStorage.setItem('sushi_reader_theme', theme);
    },

    loadReaderSettings() {
        const font = localStorage.getItem('sushi_reader_font');
        const size = localStorage.getItem('sushi_reader_size');
        const lineHeight = localStorage.getItem('sushi_reader_lineheight');
        const theme = localStorage.getItem('sushi_reader_theme');

        if (font) {
            const fontSelect = document.getElementById('reader-font-family');
            if (fontSelect) fontSelect.value = font;
        }
        if (size) {
            const sizeInput = document.getElementById('reader-font-size');
            if (sizeInput) sizeInput.value = size;
        }
        if (lineHeight) {
            const lhInput = document.getElementById('reader-line-height');
            if (lhInput) lhInput.value = lineHeight;
        }
        if (theme) {
            this.setReaderTheme(theme);
        }

        // Apply immediately
        this.applyReaderSettings();
        
        // Load TTS Settings
        const speed = localStorage.getItem('sushi_tts_speed');
        if (speed) {
            const speedInput = document.getElementById('tts-speed');
            if (speedInput) speedInput.value = speed;
            document.getElementById('tts-speed-display').innerText = speed + 'x';
        }
        this.populateTTSVoices();
    }
};
