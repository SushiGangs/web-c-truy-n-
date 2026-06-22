import { supabase } from './config.js';

export const Auth = {
    currentUser: null,
    currentProfile: null,

    async init() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            this.currentUser = session.user;
            await this.loadProfile();
        }
        
        supabase.auth.onAuthStateChange(async (event, session) => {
            if (session) {
                this.currentUser = session.user;
                await this.loadProfile();
            } else {
                this.currentUser = null;
                this.currentProfile = null;
            }
        });
    },

    async loadProfile() {
        if (!this.currentUser) return;
        const { data, error } = await supabase.from('profiles').select('*').eq('id', this.currentUser.id).single();
        if (data) {
            this.currentProfile = data;
        } else {
            // Auto create profile
            const newProfile = { id: this.currentUser.id, pen_name: 'Tác Giả ' + Math.floor(Math.random()*1000) };
            await supabase.from('profiles').insert([newProfile]);
            this.currentProfile = newProfile;
        }
    },

    async signUp(email, password) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        return data;
    },

    async signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    async signOut() {
        await supabase.auth.signOut();
        location.reload();
    }
};
