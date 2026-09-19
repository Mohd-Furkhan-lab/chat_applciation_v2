import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, ChevronDown, Hash, LogOut, MessageCircle, Plus, RefreshCw, Shield, Trash2, UserPlus, Users, X, Globe, Lock } from 'lucide-react'
import { api } from './api'

class SoundFX {
  static playChime(freq = 587.33, type = 'sine') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = type
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    } catch (e) {}
  }

  static send() { this.playChime(659.25) }
  static receive() { this.playChime(880) }
}

// Usernames are shown exactly as stored — nothing is stripped or rewritten.
const displayName = (name = '') => String(name ?? '')

// Initials only; separators act as word boundaries so "Cosmic%Leopard" -> "CL".
const initials = (name = '') => {
  const words = String(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (!words.length) return '?'
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)
  return letters.toUpperCase()
}
const time = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''
const sumUnread = (map) => Object.values(map).reduce((total, count) => total + count, 0)

// The contacts endpoint may hand back plain usernames or richer objects.
// Normalise both into { name, profile_pic } so the list renders the same way.
const toContact = (entry) => {
  if (entry && typeof entry === 'object') {
    return {
      name: entry.username || entry.user_name || entry.name || '',
      profile_pic: entry.pfp || entry.profile_pic || entry.profilePic || null,
    }
  }
  return { name: String(entry ?? ''), profile_pic: null }
}

function Avatar({ name, src, className = '', size, onClick }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [src])

  const classes = `avatar ${className}`.trim()
  const style = size ? { width: size, height: size } : undefined

  if (src && !broken) {
    const image = <img src={src} alt="" className={`${classes} avatar-img`} style={style} onError={() => setBroken(true)} />
    if (!onClick) return image
    return (
      <button type="button" className="avatar-trigger" onClick={onClick} aria-label={`View ${displayName(name)}'s picture`}>
        {image}
      </button>
    )
  }

  return <span className={classes} style={style}>{initials(name)}</span>
}

function PhotoLightbox({ src, onClose }) {
  return (
    <div className="modal-layer lightbox-layer" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="lightbox">
        <button className="icon-button lightbox-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <img src={src} alt="Profile picture" />
      </div>
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} />
      <section className="modal">
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}

function Auth({ onAuthenticated }) {
  const [mode, setMode] = useState('signin'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  
  const submit = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'signup') {
        await api.signUp(email, password)
        await api.signIn(email, password)
      } else {
        await api.signIn(email, password)
      }
      await onAuthenticated()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand">
          <span className="brand-mark"><MessageCircle size={22} /></span>
          <span>thread</span>
        </div>
        <div className="auth-copy">
          <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p>{mode === 'signin' ? 'Sign in to pick up your conversations.' : 'A quieter place to keep in touch.'}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" minLength="8" required /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="auth-switch">
          {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
          <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  )
}

export default function App() {
  const [user, setUser] = useState(null), [tab, setTab] = useState('chats'), [contacts, setContacts] = useState([]), [groups, setGroups] = useState([]), [active, setActive] = useState(null), [messages, setMessages] = useState([]), [loadingMessages, setLoadingMessages] = useState(false), [composer, setComposer] = useState(''), [modal, setModal] = useState(null), [notice, setNotice] = useState(''), [socketStatus, setSocketStatus] = useState('connecting'), [profileOpen, setProfileOpen] = useState(false)
  const [unreadChats, setUnreadChats] = useState({}), [unreadGroups, setUnreadGroups] = useState({})
  const [viewingPhoto, setViewingPhoto] = useState(null), [photoBusy, setPhotoBusy] = useState(false)
  const activeRef = useRef(active), tabRef = useRef(tab), userRef = useRef(user)
  const groupSocketsRef = useRef({})
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)

  const loadLists = useCallback(async () => {
    const [contactResult, groupResult] = await Promise.allSettled([api.contacts(), api.groups()])
    const rawContacts = contactResult.status === 'fulfilled' ? (contactResult.value.chats || []) : []
    setContacts(rawContacts.map(toContact))
    setGroups(groupResult.status === 'fulfilled' ? (groupResult.value || []) : [])
  }, [])

  const boot = useCallback(async () => {
    const profile = await api.me()
    setUser(profile)
    await loadLists()
  }, [loadLists])

  useEffect(() => { boot().catch(() => setUser(null)) }, [boot])
  useEffect(() => { setActive(null); setMessages([]) }, [tab])
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { tabRef.current = tab }, [tab])
  useEffect(() => { userRef.current = user }, [user])

  useEffect(() => {
    if (user && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [user])

  useEffect(() => {
    const total = sumUnread(unreadChats) + sumUnread(unreadGroups)
    document.title = total > 0 ? `(${total > 99 ? '99+' : total}) thread` : 'thread'
  }, [unreadChats, unreadGroups])

  const pushSystemNotification = (title, body) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      try { new Notification(title, { body }) } catch {}
    }
  }

  // Direct-message socket
  useEffect(() => {
    if (!user) return undefined
    let socket, reconnectTimer, closed = false
    const connect = () => {
      const apiOrigin = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000`
      const url = `${apiOrigin.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/connect`
      socket = new WebSocket(url)
      socket.onopen = () => setSocketStatus('connected')
      socket.onmessage = event => {
        try {
          const incoming = JSON.parse(event.data)
          if (!incoming.from || !incoming.message) return
          SoundFX.receive()
          setContacts(old => old.some(c => c.name === incoming.from) ? old : [...old, toContact(incoming.from)])
          const isOpenHere = tabRef.current === 'chats' && activeRef.current === incoming.from
          if (isOpenHere) {
            setMessages(old => [...old, { msg: incoming.message, sender: incoming.from, timestamp: new Date().toISOString() }])
          } else {
            setUnreadChats(old => ({ ...old, [incoming.from]: (old[incoming.from] || 0) + 1 }))
            setNotice(`${displayName(incoming.from)}: ${incoming.message}`)
            pushSystemNotification(`New message from ${displayName(incoming.from)}`, incoming.message)
          }
        } catch {}
      }
      socket.onerror = () => setSocketStatus('reconnecting')
      socket.onclose = () => { if (!closed) { setSocketStatus('reconnecting'); reconnectTimer = window.setTimeout(connect, 2000) } }
    }
    connect()
    return () => { closed = true; window.clearTimeout(reconnectTimer); socket?.close() }
  }, [user])

  // Group sockets
  useEffect(() => {
    if (!user) return undefined
    const apiOrigin = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000`
    const wsBase = apiOrigin.replace(/^http/, 'ws').replace(/\/$/, '')
    const live = groupSocketsRef.current
    const wanted = new Set(groups)

    Object.keys(live).forEach(name => { if (!wanted.has(name)) { live[name].close(); delete live[name] } })

    groups.forEach(name => {
      if (live[name]) return
      const entry = { closed: false, timer: null, socket: null }
      const connect = () => {
        const socket = new WebSocket(`${wsBase}/ws/connect/${encodeURIComponent(name)}`)
        entry.socket = socket
        socket.onopen = () => { if (tabRef.current === 'groups' && activeRef.current === name) setSocketStatus('connected') }
        socket.onmessage = event => {
          try {
            const incoming = JSON.parse(event.data)
            if (!incoming.sender || !incoming.msg) return
            if (incoming.sender === userRef.current?.user_name) return
            SoundFX.receive()
            const isOpenHere = tabRef.current === 'groups' && activeRef.current === name
            if (isOpenHere) {
              setMessages(old => [...old, { sender: incoming.sender, msg: incoming.msg, timestamp: new Date().toISOString() }])
            } else {
              setUnreadGroups(old => ({ ...old, [name]: (old[name] || 0) + 1 }))
              setNotice(`${displayName(name)} · ${displayName(incoming.sender)}: ${incoming.msg}`)
              pushSystemNotification(`New message in ${displayName(name)}`, `${displayName(incoming.sender)}: ${incoming.msg}`)
            }
          } catch {}
        }
        socket.onerror = () => { if (tabRef.current === 'groups' && activeRef.current === name) setSocketStatus('reconnecting') }
        socket.onclose = () => { if (!entry.closed) entry.timer = window.setTimeout(connect, 2000) }
      }
      connect()
      entry.close = () => { entry.closed = true; window.clearTimeout(entry.timer); entry.socket?.close() }
      live[name] = entry
    })
  }, [user, groups])

  useEffect(() => () => { Object.values(groupSocketsRef.current).forEach(entry => entry.close?.()); groupSocketsRef.current = {} }, [])

  const openThread = async name => {
    setActive(name)
    setLoadingMessages(true)
    setMessages([])
    if (tab === 'chats') setUnreadChats(old => (old[name] ? { ...old, [name]: 0 } : old))
    else setUnreadGroups(old => (old[name] ? { ...old, [name]: 0 } : old))
    try {
      const data = tab === 'chats' ? await api.messages(name) : await api.groupMessages(name)
      setMessages(data.messages || (Array.isArray(data) ? data : []))
    } catch (e) { setNotice(e.message) } finally { setLoadingMessages(false) }
  }

  const send = async event => {
    event.preventDefault()
    const text = composer.trim()
    if (!text || !active) return
    setComposer('')
    const optimistic = { msg: text, sender: user.user_name, timestamp: new Date().toISOString() }
    setMessages(old => [...old, optimistic])
    SoundFX.send()
    try {
      if (tab === 'chats') await api.sendMessage(active, text)
      else await api.sendGroupMessage(active, text)
    } catch (e) {
      setMessages(old => old.filter(item => item !== optimistic))
      setComposer(text)
      setNotice(e.message)
    }
  }

  const handleClearChat = async () => {
    if (!active || tab !== 'chats') return
    const target = active
    if (!window.confirm(`Are you sure you want to clear chat history with ${displayName(target)}?`)) return
    try {
      await api.clearChat(target)
      setContacts(old => old.filter(c => c.name !== target))
      setUnreadChats(old => {
        const copy = { ...old }
        delete copy[target]
        return copy
      })
      setActive(null)
      setMessages([])
      setNotice('Chat history cleared')
    } catch (e) {
      setNotice(e.message || 'Failed to clear chat')
    }
  }

  const handleGroupDeleted = (groupname) => {
    setGroups(old => old.filter(g => g !== groupname))
    setUnreadGroups(old => {
      const copy = { ...old }
      delete copy[groupname]
      return copy
    })
    if (active === groupname) {
      setActive(null)
      setMessages([])
    }
    setModal(null)
    setNotice(`Group "${displayName(groupname)}" deleted`)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, loadingMessages])

  const handlePhotoChange = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNotice('Please choose an image file')
      return
    }
    setPhotoBusy(true)
    try {
      await api.uploadProfilePic(file)
      const profile = await api.me()
      setUser(profile)
      setNotice('Profile picture updated')
    } catch (e) {
      setNotice(e.message || 'Failed to upload profile picture')
    } finally {
      setPhotoBusy(false)
    }
  }

  const signOut = async () => { try { await api.signOut() } finally { setUser(null); setActive(null) } }
  const items = tab === 'chats' ? contacts : groups.map(name => ({ name, profile_pic: null }))
  const activePic = tab === 'chats' ? contacts.find(c => c.name === active)?.profile_pic : null

  // Messages may now carry the sender's pfp directly (profile_pic / profilePic).
  // Fall back to what we already know: our own pic, or the other contact's pic in a DM.
  const messagePic = (message) => {
    const direct = message.pfp || message.profile_pic || message.profilePic
    if (direct) return direct
    if (message.sender === user.user_name) return user.profile_pic
    if (tab === 'chats') return activePic
    return null
  }
  const chatsUnreadTotal = sumUnread(unreadChats)
  const groupsUnreadTotal = sumUnread(unreadGroups)

  if (!user) return <Auth onAuthenticated={boot} />

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand"><span className="brand-mark"><MessageCircle size={18} /></span><span>thread</span></div>
        </div>
        <div className="profile-area">
          <div className="profile">
            <button
              type="button"
              className="avatar-trigger"
              onClick={() => (user.profile_pic ? setViewingPhoto(user.profile_pic) : fileInputRef.current?.click())}
              aria-label={user.profile_pic ? 'View profile picture' : 'Upload profile picture'}
            >
              {user.profile_pic ? (
                <img src={user.profile_pic} alt={displayName(user.user_name)} className="avatar avatar-img self" />
              ) : (
                <span className="avatar self">{initials(user.user_name)}</span>
              )}
            </button>
            <button className="profile-trigger" onClick={() => setProfileOpen(open => !open)} aria-expanded={profileOpen}>
              <span className="profile-copy"><strong>{displayName(user.user_name)}</strong><small>{user.email}</small></span>
              <ChevronDown className={profileOpen ? 'chevron-up' : ''} size={16} />
            </button>
          </div>
          {profileOpen && (
            <div className="profile-menu">
              <span className="profile-menu-email">Signed in as {user.email}</span>
              <button onClick={() => { fileInputRef.current?.click(); setProfileOpen(false) }} disabled={photoBusy}>
                <Camera size={16} />{photoBusy ? 'Uploading…' : user.profile_pic ? 'Change photo' : 'Add photo'}
              </button>
              <button onClick={() => { loadLists(); setProfileOpen(false) }}><RefreshCw size={16} />Refresh conversations</button>
              <button className="profile-signout" onClick={signOut}><LogOut size={16} />Sign out</button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="visually-hidden" onChange={handlePhotoChange} />
        </div>
        <nav className="tabs">
          <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}><MessageCircle size={18} />Messages{chatsUnreadTotal > 0 && <span className="tab-dot" />}</button>
          <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}><Users size={18} />Groups{groupsUnreadTotal > 0 && <span className="tab-dot" />}</button>
        </nav>
        <div className="list-heading">
          <span>{tab === 'chats' ? 'Conversations' : 'Your groups'}</span>
          <button className="icon-button" onClick={() => setModal(tab === 'chats' ? 'contact' : 'group')} aria-label="Create"><Plus size={18} /></button>
        </div>
        <div className="thread-list">
          {items.map(({ name, profile_pic }) => {
            const count = tab === 'chats' ? unreadChats[name] : unreadGroups[name]
            return (
              <button key={name} className={`thread-row ${active === name ? 'selected' : ''}`} onClick={() => openThread(name)}>
                {tab === 'groups'
                  ? <span className="avatar group-avatar"><Hash size={16} /></span>
                  : <Avatar name={name} src={profile_pic} />}
                <span className="thread-name">{displayName(name)}</span>
                {!!count && <span className="unread-badge">{count > 9 ? '9+' : count}</span>}
              </button>
            )
          })}
          {!items.length && <div className="empty-list">{tab === 'chats' ? 'No conversations yet.' : 'No groups yet.'}<button onClick={() => setModal(tab === 'chats' ? 'contact' : 'group')}>Create one</button></div>}
        </div>
        <button className="logout" onClick={signOut}><LogOut size={17} />Sign out</button>
      </aside>

      <section className="conversation">
        {active ? (
          <>
            <header className="conversation-header">
              <div>
                <h1>{tab === 'groups' && <Hash size={19} />}{displayName(active)}</h1>
                <p>{tab === 'groups' ? 'Group conversation' : 'Direct message'}<span className={`socket-state ${socketStatus}`}><i />{socketStatus === 'connected' ? 'Live' : 'Reconnecting'}</span></p>
              </div>
              <div className="header-actions">
                {tab === 'chats' && <button className="manage-button" onClick={handleClearChat} style={{ color: 'var(--danger)' }}><Trash2 size={16} />Clear chat</button>}
                {tab === 'groups' && <button className="manage-button" onClick={() => setModal('manage')}><Shield size={16} />Manage group</button>}
              </div>
            </header>
            <div className="messages">
              {loadingMessages ? (
                <div className="loading">Loading messages…</div>
              ) : messages.length ? (
                messages.map((message, index) => {
                  const mine = message.sender === user.user_name
                  return (
                    <div key={`${message.timestamp}-${index}`} className={`message-row ${mine ? 'mine' : ''}`}>
                      <Avatar name={message.sender} src={messagePic(message)} className="message-avatar" />
                      <article className={`message ${mine ? 'mine' : ''}`}>
                        <div className="message-meta"><span>{mine ? 'You' : displayName(message.sender)}</span><time>{time(message.timestamp)}</time></div>
                        <p>{message.msg || message.content}</p>
                      </article>
                    </div>
                  )
                })
              ) : (
                <div className="first-message">
                  {tab === 'groups'
                    ? <span className="avatar large"><Hash size={24} /></span>
                    : <Avatar name={active} src={activePic} className="large" onClick={activePic ? () => setViewingPhoto(activePic) : undefined} />}
                  <h2>{displayName(active)}</h2>
                  <p>Start the conversation.</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="composer" onSubmit={send}>
              <input value={composer} onChange={e => setComposer(e.target.value)} placeholder={`Message ${displayName(active)}`} aria-label="Message" />
              <button className="send-button" disabled={!composer.trim()} aria-label="Send"><ArrowUp size={18} /></button>
            </form>
          </>
        ) : (
          <div className="welcome">
            <span className="welcome-mark"><MessageCircle size={32} /></span>
            <h1>Your conversations, without the noise.</h1>
            <p>Select a {tab === 'chats' ? 'conversation' : 'group'} or start a new one.</p>
            <button className="primary" onClick={() => setModal(tab === 'chats' ? 'contact' : 'group')}><Plus size={17} />{tab === 'chats' ? 'New conversation' : 'New group'}</button>
          </div>
        )}
      </section>

      {notice && <div className="toast">{notice}<button onClick={() => setNotice('')}><X size={16} /></button></div>}
      {modal === 'contact' && <ContactModal currentUser={user.user_name} onClose={() => setModal(null)} onCreated={async name => { await loadLists(); setModal(null); setTab('chats'); await openThread(name) }} />}
      {modal === 'group' && <GroupModal onClose={() => setModal(null)} onCreated={async name => { await loadLists(); setModal(null); setTab('groups'); await openThread(name) }} />}
      {modal === 'manage' && <ManageGroupModal group={active} onClose={() => setModal(null)} onGroupDeleted={() => handleGroupDeleted(active)} />}
      {viewingPhoto && <PhotoLightbox src={viewingPhoto} onClose={() => setViewingPhoto(null)} />}
    </main>
  )
}

function ContactModal({ currentUser, onClose, onCreated }) {
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  
  const submit = async e => {
    e.preventDefault()
    const trimmed = name.trim()
    if (currentUser && trimmed.toLowerCase() === currentUser.toLowerCase()) {
      setError('Cannot add yourself as a contact')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.addContact(trimmed)
      await onCreated(trimmed)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Start a conversation" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p>Enter the username of the person you’d like to message.</p>
        <label>Username<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. alex_smith" required /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary full" disabled={busy}><UserPlus size={17} />{busy ? 'Adding…' : 'Add conversation'}</button>
      </form>
    </Modal>
  )
}

function GroupModal({ onClose, onCreated }) {
  const [mode, setMode] = useState('create'), [name, setName] = useState(''), [type, setType] = useState('public'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const join = mode === 'join'

  const submit = async e => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (join) await api.joinGroup(name.trim())
      else await api.createGroup(name.trim(), type)
      await onCreated(name.trim())
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={join ? 'Join a group' : 'Create a group'} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        {join && <p>Enter the name of an existing public group.</p>}
        <label>Group name<input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Weekend plans" required /></label>
        {!join && (
          <label>Visibility
            <select value={type} onChange={e => setType(e.target.value)}>
              <option value="public">Public — anyone can join</option>
              <option value="private">Private — members only</option>
            </select>
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <button className="primary full" disabled={busy}><Users size={17} />{busy ? 'Please wait…' : join ? 'Join group' : 'Create group'}</button>
        <button type="button" className="modal-switch" onClick={() => { setMode(join ? 'create' : 'join'); setError('') }}>
          {join ? 'Want to make a new group instead?' : 'Already have a group name? Join it'}
        </button>
      </form>
    </Modal>
  )
}

function ManageGroupModal({ group, onClose, onGroupDeleted }) {
  const [members, setMembers] = useState([])
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('member')
  const [groupType, setGroupType] = useState('public')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [membersData, groupDetails] = await Promise.allSettled([
        api.groupMembers(group),
        api.getGroup(group)
      ])

      if (membersData.status === 'fulfilled') {
        setMembers(membersData.value.message?.members || [])
      } else {
        setError(membersData.reason?.message || 'Could not load members')
      }

      if (groupDetails.status === 'fulfilled' && groupDetails.value?.type) {
        setGroupType(groupDetails.value.type)
      }
    } finally {
      setLoading(false)
    }
  }, [group])

  useEffect(() => { load() }, [load])

  const add = async event => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.addGroupMember(group, username.trim(), role)
      setUsername('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleRoleChange = async (targetUser, newRole) => {
    setBusy(true)
    setError('')
    try {
      await api.updateMemberRole(group, targetUser, newRole)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleTypeChange = async newType => {
    setBusy(true)
    setError('')
    try {
      await api.updateGroupType(group, newType)
      setGroupType(newType)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async name => {
    setBusy(true)
    setError('')
    try {
      await api.removeGroupMember(group, name)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!window.confirm(`Are you sure you want to permanently delete "${displayName(group)}"? This action cannot be undone.`)) return
    setBusy(true)
    setError('')
    try {
      await api.deleteGroup(group)
      onGroupDeleted()
    } catch (err) {
      setError(err.message || 'Failed to delete group')
      setBusy(false)
    }
  }

  return (
    <Modal title={`Manage ${displayName(group)}`} onClose={onClose}>
      <section className="manage-panel">
        <p>Invite people, change roles, or update group settings.</p>

        <div className="group-setting-row">
          <span className="setting-label">
            {groupType === 'public' ? <Globe size={15} /> : <Lock size={15} />}
            <span>Group Visibility</span>
          </span>
          <select 
            className="setting-select"
            value={groupType} 
            disabled={busy} 
            onChange={e => handleTypeChange(e.target.value)}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>

        <form className="member-form" onSubmit={add}>
          <input 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
            placeholder="Username" 
            required 
          />
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="primary" disabled={busy}>
            <UserPlus size={16} />Add
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}

        <div className="member-list">
          <span className="member-heading">Members</span>
          {loading ? (
            <p className="member-empty">Loading members…</p>
          ) : members.length ? (
            members.map((member) => {
              const isArray = Array.isArray(member)
              const name = isArray ? member[0] : member.username
              const joinedAt = isArray ? member[1] : member.joined_at
              const currentRole = isArray ? (member[2] || 'member') : (member.role || 'member')
              const pic = isArray ? null : (member.pfp || member.profile_pic || member.profilePic || null)

              return (
                <div className="member-row" key={name}>
                  <Avatar name={name} src={pic} />
                  <span className="member-name">
                    {displayName(name)}
                    {joinedAt && <small>Joined {new Date(joinedAt).toLocaleDateString()}</small>}
                  </span>

                  <select
                    className="member-role-select"
                    value={currentRole}
                    disabled={busy}
                    onChange={e => handleRoleChange(name, e.target.value)}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>

                  <button
                    className="remove-member"
                    onClick={() => remove(name)}
                    disabled={busy}
                    aria-label={`Remove ${name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )
            })
          ) : (
            <p className="member-empty">No members found.</p>
          )}
        </div>

        <div className="danger-zone">
          <span className="member-heading">Danger Zone</span>
          <button 
            type="button" 
            className="delete-group-button" 
            disabled={busy} 
            onClick={handleDeleteGroup}
          >
            <Trash2 size={16} /> Delete group
          </button>
        </div>
      </section>
    </Modal>
  )
}