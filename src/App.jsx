import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, ChevronDown, Hash, LogOut, MessageCircle, Mic, Paperclip, Pause, Play, Plus, RefreshCw, Shield, Trash2, UserPlus, Users, X, Globe, Lock, FileText, Download } from 'lucide-react'
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

// Media messages can come back under a few different field names depending on
// the endpoint (send-media response vs. chat/group history vs. the socket
// payload). Check the likely ones so the UI doesn't depend on one exact shape.
//
// The live socket broadcast, in particular, has been seen to skip a dedicated
// media field entirely and just put the raw upload URL straight into the
// normal text field — so as a last resort, treat a message whose *entire*
// text is a bare link to a media file as an attachment rather than a caption.
const looksLikeMediaUrl = (text = '') => {
  const trimmed = String(text).trim()
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return false
  if (/\.(png|jpe?g|gif|webp|bmp|svg|webm|mp3|wav|m4a|ogg|aac|mp4|mov|pdf)(\?|$)/i.test(trimmed)) return true
  // Cloudinary (and similar CDNs) often serve files with no extension in the
  // path at all, but do mark the resource type in the URL itself.
  return /\/(image|video|raw)\/upload\//i.test(trimmed)
}

const mediaUrlOf = (message = {}) => {
  const direct = message.media || message.media_url || message.file_url || message.attachment_url || message.attachment
  if (direct) return direct
  const text = message.msg || message.message || message.content
  return text && looksLikeMediaUrl(text) ? text.trim() : null
}

const mediaNameOf = (message = {}) => message.file_name || message.filename || message.name || 'Attachment'

// Prefer the media type your backend now sends explicitly; fall back to
// other likely field names, then to guessing from the URL if none exist.
const mediaTypeOf = (message = {}) =>
  (message.type || message.media_type || message.file_type || message.content_type || message.mime_type || '').toLowerCase()

const isImageMedia = (message = {}) => {
  const type = mediaTypeOf(message)
  if (type) return type.startsWith('image')
  const url = mediaUrlOf(message) || ''
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url)) return true
  return /\/image\/upload\//i.test(url)
}

const isAudioMedia = (message = {}) => {
  const type = mediaTypeOf(message)
  if (type) return type.startsWith('audio')
  const url = mediaUrlOf(message) || ''
  if (/\.(webm|mp3|wav|m4a|ogg|aac)(\?|$)/i.test(url)) return true
  if ((message.file_name || message.filename || '').startsWith('voice-note-')) return true
  // Cloudinary files audio under its "video" resource type; a plain video
  // extension (mp4/mov/etc.) wins if present, so this only catches the
  // extension-less case, which in this app is almost always a voice note.
  return /\/video\/upload\//i.test(url) && !/\.(mp4|mov|avi|mkv)(\?|$)/i.test(url)
}

const formatDuration = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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

// The groups endpoint may hand back plain group names or richer objects
// (now that groups can have a profile picture). Normalise both shapes.
const toGroup = (entry) => {
  if (entry && typeof entry === 'object') {
    return {
      name: entry.gname || entry.groupname || entry.name || '',
      profile_pic: entry.pfp || entry.profile_pic || entry.profilePic || null,
    }
  }
  return { name: String(entry ?? ''), profile_pic: null }
}

// The admin "group info" endpoint returns richer, but still loosely-typed,
// details about a group, sometimes wrapped in an { info: {...} } envelope.
// Pull out whatever fields are present so the UI can show a more precise
// picture without depending on one exact backend shape.
const toGroupMeta = (raw = {}) => {
  const info = (raw && typeof raw.info === 'object') ? raw.info : raw
  return {
    type: info.type || info.group_type || info.visibility || null,
    description: info.description || info.bio || info.about || null,
    memberCount: info.no_of_members ?? info.member_count ?? info.members_count ?? info.memberCount ?? (Array.isArray(info.members) ? info.members.length : null),
    createdAt: info.created_at || info.createdAt || info.created || null,
    profile_pic: info.group_pfp || info.profile_pic || info.pfp || info.profilePic || null,
    name: info.group_name || info.gname || null,
  }
}

// Only one voice note plays at a time — starting another pauses whatever
// was already playing, matching how chat apps usually behave.
let activeVoiceNote = null

function VoiceNotePlayer({ src }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrent(audio.currentTime)
    const onEnd = () => { setPlaying(false); setCurrent(0) }
    const onPause = () => setPlaying(false)
    const resolveDuration = () => {
      if (Number.isFinite(audio.duration)) { setDuration(audio.duration); return }
      // Recorded webm blobs sometimes report an Infinite duration until the
      // browser is forced to seek — a known MediaRecorder/Chrome quirk.
      const fix = () => { audio.removeEventListener('timeupdate', fix); setDuration(audio.duration || 0); audio.currentTime = 0 }
      audio.addEventListener('timeupdate', fix)
      audio.currentTime = 1e101
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', resolveDuration)
    audio.addEventListener('ended', onEnd)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', resolveDuration)
      audio.removeEventListener('ended', onEnd)
      audio.removeEventListener('pause', onPause)
      if (activeVoiceNote === audio) activeVoiceNote = null
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      if (activeVoiceNote && activeVoiceNote !== audio) activeVoiceNote.pause()
      activeVoiceNote = audio
      audio.play().catch(() => {})
      setPlaying(true)
    }
  }

  const seek = event => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
    setCurrent(audio.currentTime)
  }

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0
  const label = `${formatDuration(Math.floor(current))} / ${formatDuration(Math.floor(duration))}`

  return (
    <div className="voice-note">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="voice-note-play" onClick={toggle} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
        {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
      </button>
      <div className="voice-note-track" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="voice-note-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="voice-note-time">{label}</span>
    </div>
  )
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
  const [groupPics, setGroupPics] = useState({})
  const [groupMeta, setGroupMeta] = useState({})
  const [viewingPhoto, setViewingPhoto] = useState(null), [photoBusy, setPhotoBusy] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [isRecording, setIsRecording] = useState(false), [recordingSeconds, setRecordingSeconds] = useState(0)
  const activeRef = useRef(active), tabRef = useRef(tab), userRef = useRef(user)
  const groupSocketsRef = useRef({})
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaInputRef = useRef(null)
  const recorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const recordingTimerRef = useRef(null)

  const loadLists = useCallback(async () => {
    const [contactResult, groupResult] = await Promise.allSettled([api.contacts(), api.groups()])
    const rawContacts = contactResult.status === 'fulfilled' ? (contactResult.value.chats || []) : []
    setContacts(rawContacts.map(toContact))
    const normalizedGroups = (groupResult.status === 'fulfilled' ? (groupResult.value || []) : []).map(toGroup)
    setGroups(normalizedGroups.map(g => g.name))
    setGroupPics(old => {
      const next = { ...old }
      normalizedGroups.forEach(g => { if (g.profile_pic) next[g.name] = g.profile_pic })
      return next
    })
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
          // A media-only message has no text, so don't require incoming.message —
          // just require a sender plus either text or a media attachment.
          if (!incoming.from || (!incoming.message && !mediaUrlOf(incoming))) return
          SoundFX.receive()
          setContacts(old => old.some(c => c.name === incoming.from) ? old : [...old, toContact(incoming.from)])
          const isOpenHere = tabRef.current === 'chats' && activeRef.current === incoming.from
          if (isOpenHere) {
            setMessages(old => [...old, { ...incoming, msg: incoming.message, sender: incoming.from, timestamp: new Date().toISOString() }])
          } else {
            const preview = (incoming.message && !looksLikeMediaUrl(incoming.message)) ? incoming.message : 'Sent an attachment'
            setUnreadChats(old => ({ ...old, [incoming.from]: (old[incoming.from] || 0) + 1 }))
            setNotice(`${displayName(incoming.from)}: ${preview}`)
            pushSystemNotification(`New message from ${displayName(incoming.from)}`, preview)
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
            if (!incoming.sender || (!incoming.msg && !mediaUrlOf(incoming))) return
            if (incoming.sender === userRef.current?.user_name) return
            SoundFX.receive()
            const isOpenHere = tabRef.current === 'groups' && activeRef.current === name
            if (isOpenHere) {
              setMessages(old => [...old, { ...incoming, sender: incoming.sender, msg: incoming.msg, timestamp: new Date().toISOString() }])
            } else {
              const preview = (incoming.msg && !looksLikeMediaUrl(incoming.msg)) ? incoming.msg : 'Sent an attachment'
              setUnreadGroups(old => ({ ...old, [name]: (old[name] || 0) + 1 }))
              setNotice(`${displayName(name)} · ${displayName(incoming.sender)}: ${preview}`)
              pushSystemNotification(`New message in ${displayName(name)}`, `${displayName(incoming.sender)}: ${preview}`)
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

  // Single place that writes fetched group info into the two lookup maps the
  // sidebar/header read from, so both openThread and the Manage Group modal
  // (e.g. right after a photo upload) can push updates the same way.
  const applyGroupMeta = useCallback((name, meta) => {
    setGroupMeta(old => ({ ...old, [name]: meta }))
    if (meta.profile_pic) setGroupPics(old => ({ ...old, [name]: meta.profile_pic }))
  }, [])

  const fetchGroupMeta = useCallback(async name => {
    try {
      const info = await api.groupInfo(name)
      const meta = toGroupMeta(info || {})
      applyGroupMeta(name, meta)
      return meta
    } catch (e) {
      // Surfaced to the console rather than as a chat error/toast: this is a
      // background enrichment fetch (e.g. a non-admin viewer might get a 403
      // here), not something that should interrupt reading the thread.
      console.warn(`Could not load group info for "${name}":`, e)
      return null
    }
  }, [applyGroupMeta])

  const openThread = async name => {
    setActive(name)
    setLoadingMessages(true)
    setMessages([])
    if (tab === 'chats') setUnreadChats(old => (old[name] ? { ...old, [name]: 0 } : old))
    else setUnreadGroups(old => (old[name] ? { ...old, [name]: 0 } : old))
    if (tab === 'groups') fetchGroupMeta(name) // fire-and-forget, doesn't block the message load
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

  // Shared upload path for anything sent as media — picked file attachments
  // and recorded voice notes both funnel through this, for direct chats
  // (/chat/send-media) as well as groups (/groups/{groupname}/media).
  const sendFileAsMedia = async file => {
    if (!file || !active) return
    const isGroup = tab === 'groups'

    // Optimistic bubble using a local object URL so the sender sees the
    // attachment immediately; it's replaced once the server responds.
    const localUrl = URL.createObjectURL(file)
    const optimistic = {
      msg: '', sender: user.user_name, timestamp: new Date().toISOString(),
      media_url: localUrl, media_type: file.type, file_name: file.name, __localUrl: localUrl,
    }
    setMessages(old => [...old, optimistic])
    setMediaBusy(true)
    SoundFX.send()
    try {
      const result = isGroup ? await api.sendGroupMedia(active, file) : await api.sendMedia(active, file)
      setMessages(old => old.map(item => item === optimistic
        ? { ...optimistic, ...(result && typeof result === 'object' ? result : {}) }
        : item))
    } catch (e) {
      setMessages(old => old.filter(item => item !== optimistic))
      URL.revokeObjectURL(localUrl)
      setNotice(e.message || 'Failed to send attachment')
    } finally {
      setMediaBusy(false)
    }
  }

  const handleAttachFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    await sendFileAsMedia(file)
  }

  const clearRecordingTimer = () => { window.clearInterval(recordingTimerRef.current); recordingTimerRef.current = null }

  const startRecording = async () => {
    if (!active || isRecording) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setNotice('Voice recording is not supported in this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported?.('audio/webm') ? 'audio/webm' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recordedChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        clearRecordingTimer()
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        recordedChunksRef.current = []
        // A cancelled recording is stopped with no listener wired up to send it.
        if (recorder.__discard) return
        if (blob.size === 0) return
        const ext = (recorder.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type })
        sendFileAsMedia(file)
      }
      recorder.start()
      recorderRef.current = recorder
      setIsRecording(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds(s => s + 1), 1000)
    } catch (e) {
      setNotice('Microphone access was denied or is unavailable')
    }
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setIsRecording(false)
  }

  const cancelRecording = () => {
    if (recorderRef.current) recorderRef.current.__discard = true
    recorderRef.current?.stop()
    recorderRef.current = null
    setIsRecording(false)
  }

  useEffect(() => () => { clearRecordingTimer(); recorderRef.current?.stop() }, [])

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
  const activeGroupMeta = tab === 'groups' ? groupMeta[active] : null
  const groupSubtitle = (() => {
    if (!activeGroupMeta) return 'Group conversation'
    const visibility = activeGroupMeta.type === 'private' ? 'Private group' : activeGroupMeta.type === 'public' ? 'Public group' : 'Group conversation'
    return activeGroupMeta.memberCount != null ? `${visibility} · ${activeGroupMeta.memberCount} member${activeGroupMeta.memberCount === 1 ? '' : 's'}` : visibility
  })()
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
                  ? (groupPics[name]
                      ? <Avatar name={name} src={groupPics[name]} />
                      : <span className="avatar group-avatar"><Hash size={16} /></span>)
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
                <h1>
                  {tab === 'groups' && (groupPics[active]
                    ? <Avatar name={active} src={groupPics[active]} size={22} />
                    : <Hash size={19} />)}
                  {displayName(active)}
                </h1>
                <p>{tab === 'groups' ? groupSubtitle : 'Direct message'}<span className={`socket-state ${socketStatus}`}><i />{socketStatus === 'connected' ? 'Live' : 'Reconnecting'}</span></p>
              </div>
              <div className="header-actions">
                {tab === 'chats' && <button className="manage-button" onClick={handleClearChat} style={{ color: 'var(--danger)' }}><Trash2 size={16} />Clear chat</button>}
                {tab === 'groups' && <button className="manage-button" onClick={() => setModal('manage')}><Shield size={16} />Manage group</button>}
              </div>
            </header>
            {tab === 'groups' && activeGroupMeta?.description && (
              <p className="group-description">{activeGroupMeta.description}</p>
            )}
            <div className="messages">
              {loadingMessages ? (
                <div className="loading">Loading messages…</div>
              ) : messages.length ? (
                messages.map((message, index) => {
                  const mine = message.sender === user.user_name
                  const mediaSrc = mediaUrlOf(message)
                  const rawText = message.msg || message.content
                  // If the socket (or history) put the media URL straight into
                  // the text field with no separate media key, don't also
                  // print that same URL as a caption underneath.
                  const showText = rawText && rawText.trim() !== (mediaSrc || '').trim()
                  return (
                    <div key={`${message.timestamp}-${index}`} className={`message-row ${mine ? 'mine' : ''}`}>
                      <Avatar name={message.sender} src={messagePic(message)} className="message-avatar" />
                      <article className={`message ${mine ? 'mine' : ''}`}>
                        <div className="message-meta"><span>{mine ? 'You' : displayName(message.sender)}</span><time>{time(message.timestamp)}</time></div>
                        {mediaSrc && (
                          isAudioMedia(message) ? (
                            <VoiceNotePlayer src={mediaSrc} />
                          ) : isImageMedia(message) ? (
                            <button type="button" className="message-media-trigger" onClick={() => setViewingPhoto(mediaSrc)}>
                              <img src={mediaSrc} alt={mediaNameOf(message)} className="message-media-image" />
                            </button>
                          ) : (
                            <a className="message-media-file" href={mediaSrc} target="_blank" rel="noreferrer" download={mediaNameOf(message)}>
                              <FileText size={16} /><span>{mediaNameOf(message)}</span><Download size={14} />
                            </a>
                          )
                        )}
                        {showText && <p>{rawText}</p>}
                      </article>
                    </div>
                  )
                })
              ) : (
                <div className="first-message">
                  {tab === 'groups'
                    ? (groupPics[active]
                        ? <Avatar name={active} src={groupPics[active]} className="large" onClick={() => setViewingPhoto(groupPics[active])} />
                        : <span className="avatar large"><Hash size={24} /></span>)
                    : <Avatar name={active} src={activePic} className="large" onClick={activePic ? () => setViewingPhoto(activePic) : undefined} />}
                  <h2>{displayName(active)}</h2>
                  <p>Start the conversation.</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="composer" onSubmit={send}>
              {isRecording ? (
                <div className="recording-bar">
                  <button type="button" className="icon-button recording-cancel" onClick={cancelRecording} aria-label="Cancel recording"><X size={16} /></button>
                  <span className="recording-badge">
                    <span className="recording-eq"><i /><i /><i /></span>
                  </span>
                  <span className="recording-time">{formatDuration(recordingSeconds)}</span>
                  <span className="recording-hint">Recording voice note…</span>
                  <button type="button" className="send-button recording-send" onClick={stopRecording} aria-label="Stop and send"><ArrowUp size={18} /></button>
                </div>
              ) : (
                <>
                  <button type="button" className="attach-button" onClick={() => mediaInputRef.current?.click()} disabled={mediaBusy} aria-label="Attach file">
                    <Paperclip size={18} />
                  </button>
                  <input ref={mediaInputRef} type="file" className="visually-hidden" onChange={handleAttachFile} />
                  <button type="button" className="attach-button" onClick={startRecording} disabled={mediaBusy} aria-label="Record a voice note">
                    <Mic size={18} />
                  </button>
                  <input value={composer} onChange={e => setComposer(e.target.value)} placeholder={`Message ${displayName(active)}`} aria-label="Message" />
                  <button className="send-button" disabled={!composer.trim()} aria-label="Send"><ArrowUp size={18} /></button>
                </>
              )}
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
      {modal === 'manage' && <ManageGroupModal group={active} onClose={() => setModal(null)} onGroupDeleted={() => handleGroupDeleted(active)} onGroupUpdated={loadLists} onMetaLoaded={applyGroupMeta} />}
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

function ManageGroupModal({ group, onClose, onGroupDeleted, onGroupUpdated, onMetaLoaded }) {
  const [members, setMembers] = useState([])
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('member')
  const [groupType, setGroupType] = useState('public')
  const [groupPic, setGroupPic] = useState(null)
  const [groupDescription, setGroupDescription] = useState(null)
  const [memberCount, setMemberCount] = useState(null)
  const [createdAt, setCreatedAt] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const groupPhotoInputRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // The admin "info" endpoint is the more authoritative/precise source
      // for group details now — fall back to the public getGroup endpoint
      // only if it's unavailable.
      const [membersData, groupDetails] = await Promise.allSettled([
        api.groupMembers(group),
        api.groupInfo(group).catch(() => api.getGroup(group))
      ])

      if (membersData.status === 'fulfilled') {
        setMembers(membersData.value.message?.members || [])
      } else {
        setError(membersData.reason?.message || 'Could not load members')
      }

      if (groupDetails.status === 'fulfilled') {
        // Logged so it's easy to check in devtools exactly what this endpoint
        // returns — useful if a field (e.g. the picture) isn't showing up.
        console.debug(`[groupInfo] ${group}:`, groupDetails.value)
        const meta = toGroupMeta(groupDetails.value || {})
        if (meta.type) setGroupType(meta.type)
        setGroupPic(meta.profile_pic)
        setGroupDescription(meta.description)
        setMemberCount(meta.memberCount)
        setCreatedAt(meta.createdAt)
        onMetaLoaded?.(group, meta)
      } else {
        console.warn(`[groupInfo] ${group} failed:`, groupDetails.reason)
      }
    } finally {
      setLoading(false)
    }
  }, [group, onMetaLoaded])

  useEffect(() => { load() }, [load])

  const handlePhotoChange = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file')
      return
    }
    setPhotoBusy(true)
    setError('')
    try {
      await api.uploadGroupPfp(group, file)
      await load()
      await onGroupUpdated?.()
    } catch (err) {
      setError(err.message || 'Failed to upload group picture')
    } finally {
      setPhotoBusy(false)
    }
  }

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

        {!loading && (groupDescription || memberCount != null || createdAt) && (
          <div className="group-info-block">
            {groupDescription && <p className="group-info-description">{groupDescription}</p>}
            {(memberCount != null || createdAt) && (
              <p className="group-info-stats">
                {memberCount != null && <span>{memberCount} member{memberCount === 1 ? '' : 's'}</span>}
                {memberCount != null && createdAt && <span> · </span>}
                {createdAt && <span>Created {new Date(createdAt).toLocaleDateString()}</span>}
              </p>
            )}
          </div>
        )}

        <div className="group-setting-row">
          <span className="setting-label">
            <Camera size={15} />
            <span>{photoBusy ? 'Uploading…' : 'Group Photo'}</span>
          </span>
          <button
            type="button"
            className="avatar-trigger"
            onClick={() => groupPhotoInputRef.current?.click()}
            disabled={photoBusy}
            aria-label={groupPic ? 'Change group picture' : 'Upload group picture'}
          >
            <Avatar name={group} src={groupPic} size={34} />
          </button>
          <input ref={groupPhotoInputRef} type="file" accept="image/*" className="visually-hidden" onChange={handlePhotoChange} />
        </div>

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