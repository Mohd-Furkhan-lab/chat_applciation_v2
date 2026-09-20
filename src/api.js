// In development Vite proxies these paths to the API, avoiding cross-origin cookie issues.
// Set VITE_API_URL when deploying behind a different API host.
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request(path, options = {}, isRetry = false) {
  const { headers: customHeaders, ...restOptions } = options
  // FormData needs the browser to set its own multipart Content-Type (with boundary),
  // so we skip the default JSON header whenever the body is a FormData instance.
  const isFormData = typeof FormData !== 'undefined' && restOptions.body instanceof FormData
  const finalOptions = {
    credentials: 'include',
    ...restOptions,
    headers: isFormData ? { ...customHeaders } : { 'Content-Type': 'application/json', ...customHeaders },
  }

  try {
    const response = await fetch(`${API_URL}${path}`, finalOptions)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      if (
        response.status === 401 && 
        !isRetry && 
        !path.includes('/users/login') && 
        !path.includes('/users/refresh') && 
        !path.includes('/users/signup')
      ) {
        try {
          await request('/users/refresh', { method: 'POST' }, true)
          return await request(path, options, true)
        } catch (refreshErr) {
          // Fall through
        }
      }

      throw new Error(data.detail || data.message || 'Something went wrong.')
    }
    return data
  } catch (err) {
    throw err
  }
}

export const api = {
  // Users
  signUp: (email, password) => request('/users/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signIn: (email, password) => request('/users/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signOut: () => request('/users/logout', { method: 'POST' }),
  refresh: () => request('/users/refresh', { method: 'POST' }),
  me: () => request('/users/me'),
  uploadProfilePic: (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return request('/users/profile-pic/upload', { method: 'POST', body: formData })
  },

  // Direct Chats
  contacts: () => request('/chat/contacts'),
  addContact: (username) => request(`/chat/${encodeURIComponent(username)}`, { method: 'POST' }),
  messages: (username) => request(`/chat/${encodeURIComponent(username)}`),
  sendMessage: (to, msg) => request('/chat/send-msg', { method: 'POST', body: JSON.stringify({ to, msg }) }),
  sendMedia: (to, file) => {
    const formData = new FormData()
    formData.append('to', to)
    formData.append('file', file)
    return request('/chat/send-media', { method: 'POST', body: formData })
  },
  clearChat: (username) => request(`/chat/clear-chat/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  // Groups
  groups: () => request('/groups/'),
  getGroup: (groupname) => request(`/groups/${encodeURIComponent(groupname)}`),
  createGroup: (gname, type) => request('/groups/', { method: 'POST', body: JSON.stringify({ gname, type }) }),
  updateGroupType: (gname, new_type) => request('/groups/', { method: 'PUT', body: JSON.stringify({ gname, new_type }) }),
  joinGroup: (groupname) => request(`/groups/members/${encodeURIComponent(groupname)}`, { method: 'POST' }),
  groupMessages: (groupname) => request(`/groups/${encodeURIComponent(groupname)}/chat`),
  sendGroupMessage: (groupname, msg) => request(`/groups/${encodeURIComponent(groupname)}/chat`, { method: 'POST', body: JSON.stringify({ msg }) }),
  sendGroupMedia: (groupname, file) => {
    const formData = new FormData()
    formData.append('file', file)
    return request(`/groups/${encodeURIComponent(groupname)}/media`, { method: 'POST', body: formData })
  },

  // Admin
  groupMembers: (groupname) => request(`/admin/${encodeURIComponent(groupname)}/members`),
  groupInfo: (groupname) => request(`/admin/${encodeURIComponent(groupname)}/info`),
  uploadGroupPfp: (groupname, file) => {
    const formData = new FormData()
    formData.append('file', file)
    return request(`/admin/${encodeURIComponent(groupname)}/profile-pic`, { method: 'POST', body: formData })
  },
  addGroupMember: (groupname, username, role = 'member') => request(`/admin/${encodeURIComponent(groupname)}/members`, { method: 'POST', body: JSON.stringify({ username, role }) }),
  updateMemberRole: (groupname, username, new_role) => request(`/admin/${encodeURIComponent(groupname)}/members/role`, { method: 'PUT', body: JSON.stringify({ username, new_role }) }),
  removeGroupMember: (groupname, username) => request(`/admin/${encodeURIComponent(groupname)}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  deleteGroup: (groupname) => request(`/admin/${encodeURIComponent(groupname)}`, { method: 'DELETE' }),
}