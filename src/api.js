// In development Vite proxies these paths to the API, avoiding cross-origin cookie issues.
// Set VITE_API_URL when deploying behind a different API host.
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || data.message || 'Something went wrong.')
  return data
}

export const api = {
  signUp: (email, password) => request('/users/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signIn: (email, password) => request('/users/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signOut: () => request('/users/logout', { method: 'POST' }),
  me: () => request('/users/me'),
  contacts: () => request('/chat/contacts'),
  addContact: (username) => request(`/chat/${encodeURIComponent(username)}`, { method: 'POST' }),
  messages: (username) => request(`/chat/${encodeURIComponent(username)}`),
  sendMessage: (to, msg) => request('/chat/send-msg', { method: 'POST', body: JSON.stringify({ to, msg }) }),
  groups: () => request('/groups/'),
  createGroup: (gname, type) => request('/groups/', { method: 'POST', body: JSON.stringify({ gname, type }) }),
  joinGroup: (groupname) => request(`/groups/members/${encodeURIComponent(groupname)}`, { method: 'POST' }),
  groupMessages: (groupname) => request(`/groups/${encodeURIComponent(groupname)}/chat`),
  sendGroupMessage: (groupname, msg) => request(`/groups/${encodeURIComponent(groupname)}/chat`, { method: 'POST', body: JSON.stringify({ msg }) }),
  groupMembers: (groupname) => request(`/admin/${encodeURIComponent(groupname)}/members`),
  addGroupMember: (groupname, username, role = 'member') => request(`/admin/${encodeURIComponent(groupname)}/members`, { method: 'POST', body: JSON.stringify({ username, role }) }),
  removeGroupMember: (groupname, username) => request(`/admin/${encodeURIComponent(groupname)}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
}
