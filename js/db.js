import { supabase } from './config.js';
import { Auth } from './auth.js';

export const DB = {
    async getStories(tag = '', search = '', page = 1, limit = 10, orderBy = 'created_at') {
        let query = supabase.from('stories').select('*, profiles:author_id(pen_name)', { count: 'exact' })
            .eq('is_published', true)
            .order(orderBy, { ascending: false });
        
        if (tag) query = query.contains('tags', [tag]);
        if (search) query = query.ilike('title', `%${search}%`);
        
        // Pagination
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to);
        
        const { data, error, count } = await query;
        if (error) throw error;
        for (let s of data) {
            s.chaptersCount = s.chapters_count || 0;
            s.author = s.profiles?.pen_name || 'Vô danh';
        }
        return { data, count };
    },

    async getTopFollowedStories(limit = 10) {
        let query = supabase.from('stories').select('*, profiles:author_id(pen_name)')
            .eq('is_published', true)
            .order('followers_count', { ascending: false, nullsFirst: false })
            .limit(limit);
        
        const { data, error } = await query;
        if (error) throw error;
        for (let s of data) {
            s.chaptersCount = s.chapters_count || 0;
            s.author = s.profiles?.pen_name || 'Vô danh';
        }
        return data;
    },

    async getMyStories() {
        if (!Auth.currentUser) return [];
        const { data, error } = await supabase.from('stories')
            .select('*')
            .eq('author_id', Auth.currentUser.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        for (let s of data) {
            s.chaptersCount = s.chapters_count || 0;
        }
        return data;
    },

    async getStory(id) {
        const { data, error } = await supabase.from('stories').select('*, profiles:author_id(pen_name)').eq('id', id).single();
        if (error) throw error;
        if(data) data.author = data.profiles?.pen_name || 'Vô danh';
        return data;
    },

    async saveStory(storyObj) {
        if (!Auth.currentUser) throw new Error("Chưa đăng nhập");
        const payload = {
            title: storyObj.title,
            description: storyObj.desc,
            tags: storyObj.tags,
            cover_url: storyObj.cover,
            is_published: storyObj.isPublished,
            author_id: Auth.currentUser.id
        };
        if (storyObj.id) {
            const { data, error } = await supabase.from('stories').update(payload).eq('id', storyObj.id).select().single();
            if (error) throw error;
            return data;
        } else {
            const { data, error } = await supabase.from('stories').insert([payload]).select().single();
            if (error) throw error;
            return data;
        }
    },

    async deleteStory(id) {
        const { error } = await supabase.from('stories').delete().eq('id', id);
        if (error) throw error;
    },

    async getChapters(storyId, isAuthor = false) {
        let query = supabase.from('chapters').select('*').eq('story_id', storyId).order('chapter_order', { ascending: true });
        if (!isAuthor) query = query.eq('is_published', true);
        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async saveChapter(chapObj) {
        const payload = {
            title: chapObj.title,
            content: chapObj.content,
            chapter_order: chapObj.order,
            is_published: chapObj.isPublished,
            story_id: chapObj.storyId
        };
        if (chapObj.id) {
            const { data, error } = await supabase.from('chapters').update({title: payload.title, content: payload.content, is_published: payload.is_published}).eq('id', chapObj.id);
            if (error) throw error;
        } else {
            const { data, error } = await supabase.from('chapters').insert([payload]);
            if (error) throw error;
        }
    },

    async saveHistory(storyId, chapterId, lastParagraphIndex = 0, scrollPercentage = 0) {
        if (!Auth.currentUser) return;
        const payload = {
            user_id: Auth.currentUser.id,
            story_id: storyId,
            last_chapter_id: chapterId,
            last_paragraph_index: lastParagraphIndex,
            last_scroll_percentage: scrollPercentage,
            updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('reading_history').upsert(payload, { onConflict: 'user_id, story_id' });
        if (error) console.error("Lỗi lưu lịch sử", error);
    },

    async saveReadingEvent(storyId, chapterId, maxScrollPercentage, timeSpentSeconds) {
        if (!Auth.currentUser) return;
        const payload = {
            user_id: Auth.currentUser.id,
            story_id: storyId,
            chapter_id: chapterId,
            max_scroll_percentage: maxScrollPercentage,
            time_spent_seconds: timeSpentSeconds
        };
        const { error } = await supabase.from('reading_events').insert([payload]);
        if (error) console.error("Lỗi lưu reading event", error);
    },

    async getHistory() {
        if (!Auth.currentUser) return [];
        const { data, error } = await supabase.from('reading_history')
            .select('*, stories(*), chapters(*)')
            .eq('user_id', Auth.currentUser.id)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async getReadChapters(storyId) {
        if (!Auth.currentUser) return [];
        // Lấy danh sách chapter_id từ reading_events mà user đã đọc > 5s
        const { data, error } = await supabase.from('reading_events')
            .select('chapter_id')
            .eq('user_id', Auth.currentUser.id)
            .eq('story_id', storyId);
        if (error) {
            console.error("Lỗi lấy read chapters", error);
            return [];
        }
        return [...new Set(data.map(d => d.chapter_id))];
    },

    async getStoryAnalytics(storyId) {
        if (!Auth.currentUser) return null;
        const { data, error } = await supabase.rpc('get_story_analytics', { p_story_id: storyId });
        if (error) {
            console.error("Lỗi lấy analytics", error);
            return null;
        }
        return data && data.length > 0 ? data[0] : null;
    },

    async toggleFollow(storyId) {
        if (!Auth.currentUser) return false;
        // Kiem tra da follow chua
        const { data } = await supabase.from('follows').select('*').eq('user_id', Auth.currentUser.id).eq('story_id', storyId).single();
        if (data) {
            await supabase.from('follows').delete().eq('user_id', Auth.currentUser.id).eq('story_id', storyId);
            return false; // unfollowed
        } else {
            await supabase.from('follows').insert([{ user_id: Auth.currentUser.id, story_id: storyId }]);
            return true; // followed
        }
    },

    async getFollows() {
        if (!Auth.currentUser) return [];
        const { data, error } = await supabase.from('follows')
            .select('*, stories(*)')
            .eq('user_id', Auth.currentUser.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
    },

    async checkFollow(storyId) {
        if (!Auth.currentUser) return false;
        const { data } = await supabase.from('follows').select('*').eq('user_id', Auth.currentUser.id).eq('story_id', storyId).single();
        return !!data;
    },

    async updateProfile(penName, bio, avatarUrl) {
        if (!Auth.currentUser) return;
        const { error } = await supabase.from('profiles').update({ pen_name: penName, bio: bio, avatar_url: avatarUrl }).eq('id', Auth.currentUser.id);
        if (error) throw error;
        Auth.currentProfile.pen_name = penName;
        Auth.currentProfile.bio = bio;
        Auth.currentProfile.avatar_url = avatarUrl;
    },

    // --- COMMENTS ---
    async getComments(storyId, chapterId = null) {
        let query = supabase.from('comments')
            .select('*, profiles:user_id(pen_name, avatar_url)')
            .eq('story_id', storyId)
            .order('created_at', { ascending: false });
        
        if (chapterId) {
            query = query.eq('chapter_id', chapterId);
        } else {
            query = query.is('chapter_id', null);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
    },

    async addComment(storyId, chapterId, content) {
        if (!Auth.currentUser) throw new Error("Chưa đăng nhập");
        const payload = {
            story_id: storyId,
            chapter_id: chapterId,
            user_id: Auth.currentUser.id,
            content: content
        };
        const { data, error } = await supabase.from('comments').insert([payload]).select().single();
        if (error) throw error;
        return data;
    }
};
