import { createClient, SupabaseClient } from '@supabase/supabase-js'

let supabase: SupabaseClient | null = null

export const initSupabase = (url: string, anonKey: string) => {
  supabase = createClient(url, anonKey)
  return supabase
}

export const getSupabase = () => supabase

export interface ProjectRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  page_size: string
  pages: unknown
  prompt: string
  chapters: string
}

export const fetchProjects = async (): Promise<ProjectRow[]> => {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })
  
  if (error) {
    console.error('Fetch error:', error)
    return []
  }
  return data || []
}

export const saveProject = async (project: Omit<ProjectRow, 'created_at'>): Promise<ProjectRow | null> => {
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
