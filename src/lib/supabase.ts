import { createClient, SupabaseClient, User } from '@supabase/supabase-js'

let supabase: SupabaseClient | null = null

export const initSupabase = (url: string, anonKey: string) => {
  supabase = createClient(url, anonKey)
  return supabase
}

export const getSupabase = () => supabase

// 관리자 이메일
const ADMIN_EMAIL = 'motiol_6829@naver.com'

export interface ProjectRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  page_size: string
  pages: unknown
  prompt: string
  chapters: string
  user_id?: string  // 프로젝트 소유자
  thumbnail?: string  // Base64 썸네일 이미지
}

export interface UserRow {
  id: string
  email: string
  role: 'admin' | 'viewer' | 'approved' | 'pending'
  created_at: string
}

// ============ AUTH ============

export const signUp = async (email: string, password: string): Promise<{ user: User | null; error: string | null }> => {
  if (!supabase) return { user: null, error: 'Supabase not initialized' }
  
  const { data, error } = await supabase.auth.signUp({ email, password })
  
  if (error) return { user: null, error: error.message }
  
  // 회원가입 성공 시 users 테이블에 추가 (insert로 변경)
  if (data.user) {
    const role = email === ADMIN_EMAIL ? 'admin' : 'pending'
    await supabase.from('users').insert({
      id: data.user.id,
      email: email,
      role: role,
      created_at: new Date().toISOString()
    })
  }
  
  return { user: data.user, error: null }
}

export const signIn = async (email: string, password: string): Promise<{ user: User | null; error: string | null }> => {
  if (!supabase) return { user: null, error: 'Supabase not initialized' }
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  
  if (error) return { user: null, error: error.message }
  
  // 로그인 시 users 테이블에 없을 때만 추가 (기존 role 유지)
  if (data.user) {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', data.user.id)
      .single()
    
    // 유저가 없을 때만 새로 추가
    if (!existingUser) {
      const role = email === ADMIN_EMAIL ? 'admin' : 'pending'
      await supabase.from('users').insert({
        id: data.user.id,
        email: email,
        role: role,
        created_at: new Date().toISOString()
      })
    }
  }
  
  return { user: data.user, error: null }
}

export const signOut = async (): Promise<void> => {
  if (!supabase) return
  await supabase.auth.signOut()
}

export const getCurrentUser = async (): Promise<User | null> => {
  if (!supabase) return null
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export const getSession = async () => {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// ============ USER MANAGEMENT ============

export const getUserRole = async (userId: string): Promise<'admin' | 'viewer' | 'approved' | 'pending' | null> => {
  if (!supabase) return null
  
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()
  
  if (error || !data) return 'pending'
  return data.role
}

export const getAllUsers = async (): Promise<UserRow[]> => {
  if (!supabase) return []
  
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) return []
  return data || []
}

export const updateUserRole = async (userId: string, role: 'admin' | 'viewer' | 'approved' | 'pending'): Promise<boolean> => {
  if (!supabase) return false
  
  const { error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
  
  return !error
}

export const isAdmin = async (userId: string): Promise<boolean> => {
  const role = await getUserRole(userId)
  return role === 'admin'
}

export const canViewProjects = async (userId: string): Promise<boolean> => {
  const role = await getUserRole(userId)
  return role === 'admin' || role === 'approved'
}

// 사용자 본인의 프로젝트만 조회
export const fetchProjects = async (userId?: string): Promise<ProjectRow[]> => {
  if (!supabase) return []
  
  let query = supabase.from('projects').select('*').order('updated_at', { ascending: false })
  
  if (userId) {
    query = query.eq('user_id', userId)
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error('Fetch error:', error)
    return []
  }
  return data || []
}

// 관리자용: 모든 프로젝트 조회
export const fetchAllProjects = async (): Promise<ProjectRow[]> => {
  if (!supabase) return []
  
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })
  
  if (error) {
    console.error('Fetch all error:', error)
    return []
  }
  return data || []
}

export const saveProject = async (project: Omit<ProjectRow, 'created_at'>, userId?: string): Promise<{ data: ProjectRow | null; error: string | null }> => {
  if (!supabase) return { data: null, error: 'Supabase not initialized' }
  
  const { data, error } = await supabase
    .from('projects')
    .upsert({
      id: project.id,
      title: project.title,
      updated_at: project.updated_at,
      page_size: project.page_size,
      pages: project.pages,
      prompt: project.prompt,
      chapters: project.chapters,
      user_id: userId || project.user_id,
      thumbnail: project.thumbnail,
    }, { onConflict: 'id' })
    .select()
    .single()
  
  if (error) {
    console.error('Save error:', error)
    return { data: null, error: error.message }
  }
  return { data, error: null }
}

export const deleteProjectFromDB = async (id: string): Promise<boolean> => {
  if (!supabase) return false
  
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Delete error:', error)
    return false
  }
  return true
}
