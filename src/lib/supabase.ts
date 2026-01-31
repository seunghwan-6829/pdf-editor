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
}

export interface UserRow {
  id: string
  email: string
  role: 'admin' | 'approved' | 'pending'
  created_at: string
}

// ============ AUTH ============

export const signUp = async (email: string, password: string): Promise<{ user: User | null; error: string | null }> => {
  if (!supabase) return { user: null, error: 'Supabase not initialized' }
  
  const { data, error } = await supabase.auth.signUp({ email, password })
  
  if (error) return { user: null, error: error.message }
  
  // 회원가입 성공 시 users 테이블에 추가
  if (data.user) {
    const role = email === ADMIN_EMAIL ? 'admin' : 'pending'
    await supabase.from('users').upsert({
      id: data.user.id,
      email: email,
      role: role,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' })
  }
  
  return { user: data.user, error: null }
}

export const signIn = async (email: string, password: string): Promise<{ user: User | null; error: string | null }> => {
  if (!supabase) return { user: null, error: 'Supabase not initialized' }
  
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  
  if (error) return { user: null, error: error.message }
  
  // 로그인 시 users 테이블에 없으면 추가
  if (data.user) {
    const role = email === ADMIN_EMAIL ? 'admin' : 'pending'
    await supabase.from('users').upsert({
      id: data.user.id,
      email: email,
      role: role,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' })
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

export const getUserRole = async (userId: string): Promise<'admin' | 'approved' | 'pending' | null> => {
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

export const updateUserRole = async (userId: string, role: 'admin' | 'approved' | 'pending'): Promise<boolean> => {
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

export const saveProject = async (project: Omit<ProjectRow, 'created_at'>, userId?: string): Promise<ProjectRow | null> => {
  if (!supabase) return null
  
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
    }, { onConflict: 'id' })
    .select()
    .single()
  
  if (error) {
    console.error('Save error:', error)
    return null
  }
  return data
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
