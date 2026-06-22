export const UI = {
    confirmCallback: null,

    toast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if(!container) return;
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
        const modal = document.getElementById('modal-confirm');
        if(!modal) return;
        document.getElementById('confirm-message').innerText = message;
        modal.classList.remove('hidden');
        this.confirmCallback = callback;
        document.getElementById('btn-confirm-ok').onclick = () => {
            modal.classList.add('hidden');
            if(this.confirmCallback) this.confirmCallback();
        };
    },

    closeConfirmModal() {
        document.getElementById('modal-confirm')?.classList.add('hidden');
        this.confirmCallback = null;
    },

    hideAllViews() {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        this.closeModals();
        window.scrollTo(0, 0);
    },

    showView(viewId) {
        this.hideAllViews();
        document.getElementById('avatar-dropdown')?.classList.remove('show');
        const view = document.getElementById(viewId);
        if(view) view.classList.remove('hidden');
    },

    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => {
            // Keep cropper closed via its own method if needed, but this works generally
            el.classList.add('hidden');
        });
    },

    escapeHTML(str) {
        if(!str) return '';
        return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    },

    updateAuthUI(profile) {
        const avatarBtn = document.getElementById('user-avatar');
        const loginBtn = document.getElementById('btn-login-header');
        if(!avatarBtn) return;
        
        if (profile) {
            if(loginBtn) loginBtn.classList.add('hidden');
            avatarBtn.classList.remove('hidden');
            if (profile.avatar_url) {
                avatarBtn.style.backgroundImage = `url('${profile.avatar_url}')`;
                avatarBtn.innerText = '';
            } else {
                avatarBtn.style.backgroundImage = 'none';
                avatarBtn.innerText = profile.pen_name ? profile.pen_name.charAt(0).toUpperCase() : 'U';
            }
        } else {
            if(loginBtn) loginBtn.classList.remove('hidden');
            avatarBtn.classList.add('hidden');
        }
    }
};
