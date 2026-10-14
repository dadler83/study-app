import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import './App.css'

type Flashcard = {
  id: string
  front: string
  back: string
  frontImage?: string
  backImage?: string
  frontDrawing?: string
  backDrawing?: string
}

type FlashcardSet = {
  id: string
  name: string
  cards: Flashcard[]
}

type StudyGroup = {
  id: string
  name: string
  setIds: string[]
}

type Library = {
  sets: FlashcardSet[]
  groups: StudyGroup[]
  activeSetId: string
}

const STORAGE_KEY = 'recall-flashcards-v1'

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isImageData(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/')
}

function isFlashcard(value: unknown): value is Flashcard {
  if (!value || typeof value !== 'object') return false
  const card = value as Record<string, unknown>
  const front = typeof card.front === 'string' ? card.front : ''
  const back = typeof card.back === 'string' ? card.back : ''
  const frontImage = isImageData(card.frontImage) ? card.frontImage : undefined
  const backImage = isImageData(card.backImage) ? card.backImage : undefined
  const frontDrawing = isImageData(card.frontDrawing) ? card.frontDrawing : undefined
  const backDrawing = isImageData(card.backDrawing) ? card.backDrawing : undefined
  return (front.trim().length > 0 || Boolean(frontImage || frontDrawing)) &&
    (back.trim().length > 0 || Boolean(backImage || backDrawing))
}

function normalizeCard(value: unknown): Flashcard | null {
  if (!isFlashcard(value)) return null
  const card = value as Flashcard
  return {
    id: typeof card.id === 'string' ? card.id : makeId(),
    front: typeof card.front === 'string' ? card.front : '',
    back: typeof card.back === 'string' ? card.back : '',
    ...(isImageData(card.frontImage) ? { frontImage: card.frontImage } : {}),
    ...(isImageData(card.backImage) ? { backImage: card.backImage } : {}),
    ...(isImageData(card.frontDrawing) ? { frontDrawing: card.frontDrawing } : {}),
    ...(isImageData(card.backDrawing) ? { backDrawing: card.backDrawing } : {}),
  }
}

function loadLibrary(): Library {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = saved ? JSON.parse(saved) : null
    if (Array.isArray(parsed)) {
      const cards = parsed.map(normalizeCard).filter((card): card is Flashcard => card !== null)
      const set = { id: makeId(), name: 'My flashcards', cards }
      return { sets: [set], groups: [], activeSetId: set.id }
    }
    if (parsed && typeof parsed === 'object' && 'sets' in parsed && Array.isArray(parsed.sets)) {
      const sets = parsed.sets.flatMap((value): FlashcardSet[] => {
        if (!value || typeof value !== 'object') return []
        const item = value as Record<string, unknown>
        if (typeof item.name !== 'string') return []
        const cards = Array.isArray(item.cards) ? item.cards.map(normalizeCard).filter((card): card is Flashcard => card !== null) : []
        return [{ id: typeof item.id === 'string' ? item.id : makeId(), name: item.name, cards }]
      })
      if (sets.length > 0) {
        const validSetIds = new Set(sets.map((set) => set.id))
        const groups = 'groups' in parsed && Array.isArray(parsed.groups)
          ? parsed.groups.flatMap((value): StudyGroup[] => {
            if (!value || typeof value !== 'object') return []
            const group = value as Record<string, unknown>
            if (typeof group.name !== 'string' || !Array.isArray(group.setIds)) return []
            const setIds = [...new Set(group.setIds.filter((id): id is string => typeof id === 'string' && validSetIds.has(id)))]
            return setIds.length >= 2 ? [{ id: typeof group.id === 'string' ? group.id : makeId(), name: group.name, setIds }] : []
          })
          : []
        const activeSetId = 'activeSetId' in parsed && typeof parsed.activeSetId === 'string' && sets.some((set) => set.id === parsed.activeSetId)
          ? parsed.activeSetId
          : sets[0].id
        return { sets, groups, activeSetId }
      }
    }
  } catch {
    // Start with an empty library if stored data cannot be read.
  }
  const set = { id: makeId(), name: 'My first set', cards: [] }
  return { sets: [set], groups: [], activeSetId: set.id }
}

function readImage(file: File): Promise<string> {
  return createImageBitmap(file).then((bitmap) => {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to process image.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.78)
  })
}

function cardSignature(card: Flashcard) {
  return `${card.front.trim().toLocaleLowerCase()}\u0000${card.back.trim().toLocaleLowerCase()}\u0000${card.frontImage ?? ''}\u0000${card.backImage ?? ''}\u0000${card.frontDrawing ?? ''}\u0000${card.backDrawing ?? ''}`
}

function safeFileName(name: string) {
  return name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLocaleLowerCase() || 'flashcards'
}

function DrawingPad({ label, value, onChange }: { label: string; value: string; onChange: (image: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (value) {
      const image = new Image()
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height)
      image.src = value
    }
  }, [value])

  function position(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const bounds = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    }
  }

  function startDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const context = canvas.getContext('2d')
    if (!context) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = position(event)
    drawing.current = true
    context.beginPath()
    context.moveTo(point.x, point.y)
    context.lineWidth = 7
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = '#315f45'
  }

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current!
    const context = canvas.getContext('2d')
    if (!context) return
    const point = position(event)
    context.lineTo(point.x, point.y)
    context.stroke()
  }

  function finishDrawing() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clearDrawing() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    onChange('')
  }

  return (
    <div className="drawing-field">
      <div className="media-label-row"><span>OR DRAW {label}</span><button type="button" onClick={clearDrawing} disabled={!value}>Clear</button></div>
      <canvas ref={canvasRef} className="drawing-canvas" width={1000} height={600} aria-label={`Draw on the ${label.toLowerCase()}`} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} />
    </div>
  )
}

function Icon({ name, size = 18 }: { name: 'spark' | 'plus' | 'arrow' | 'upload' | 'download' | 'trash' | 'edit' | 'chevron' | 'rotate' | 'layers' | 'check' | 'close' | 'shuffle'; size?: number }) {
  const shared = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  switch (name) {
    case 'spark': return <svg {...shared}><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>
    case 'plus': return <svg {...shared}><path d="M12 5v14M5 12h14" /></svg>
    case 'arrow': return <svg {...shared}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'upload': return <svg {...shared}><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" /></svg>
    case 'download': return <svg {...shared}><path d="M12 4v12m-4-4 4 4 4-4" /><path d="M20 17v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2" /></svg>
    case 'trash': return <svg {...shared}><path d="M4 7h16M10 11v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3" /></svg>
    case 'edit': return <svg {...shared}><path d="m14 5 5 5M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z" /><path d="M13 20h7" /></svg>
    case 'chevron': return <svg {...shared}><path d="m9 18 6-6-6-6" /></svg>
    case 'rotate': return <svg {...shared}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3" /></svg>
    case 'layers': return <svg {...shared}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></svg>
    case 'check': return <svg {...shared}><path d="m5 12 4 4L19 6" /></svg>
    case 'close': return <svg {...shared}><path d="m18 6-12 12M6 6l12 12" /></svg>
    case 'shuffle': return <svg {...shared}><path d="m18 14 4 4-4 4M18 2l4 4-4 4" /><path d="M2 18h2.5a6 6 0 0 0 4.2-1.7l6.6-8.6A6 6 0 0 1 20 6h2M2 6h2.5a6 6 0 0 1 4.2 1.7M14 16.3l.9 1A6 6 0 0 0 19 19h3" /></svg>
  }
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]]
  }
  return shuffled
}

function App() {
  const [library, setLibrary] = useState<Library>(loadLibrary)
  const [setName, setSetName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([])
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [frontImage, setFrontImage] = useState('')
  const [backImage, setBackImage] = useState('')
  const [frontDrawing, setFrontDrawing] = useState('')
  const [backDrawing, setBackDrawing] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewDeck, setReviewDeck] = useState<Flashcard[]>([])
  const [reviewOrder, setReviewOrder] = useState<string[]>([])
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewIndex, setReviewIndex] = useState(0)
  const [isReviewFlipped, setIsReviewFlipped] = useState(false)
  const [reviewResults, setReviewResults] = useState({ correct: 0, incorrect: 0 })
  const [dragX, setDragX] = useState(0)
  const [notice, setNotice] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  const frontImageInput = useRef<HTMLInputElement>(null)
  const backImageInput = useRef<HTMLInputElement>(null)
  const gesture = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
    } catch {
      window.setTimeout(() => setNotice('Storage is full. Export your sets to keep a backup, then remove a few large images.'), 0)
    }
  }, [library])

  const currentSet = library.sets.find((set) => set.id === library.activeSetId) ?? library.sets[0]
  const cards = currentSet?.cards ?? []
  const currentReviewCard = reviewDeck.find((card) => card.id === reviewOrder[reviewIndex])
  const selectedSets = library.sets.filter((set) => selectedSetIds.includes(set.id))
  const selectedCards = selectedSets.flatMap((set) => set.cards)

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = groupName.trim()
    const setIds = selectedSets.map((set) => set.id)
    if (!name || setIds.length < 2) return
    const takenNames = new Set(library.groups.map((group) => group.name.toLocaleLowerCase()))
    let uniqueName = name
    let suffix = 2
    while (takenNames.has(uniqueName.toLocaleLowerCase())) uniqueName = `${name} (${suffix++})`
    const group = { id: makeId(), name: uniqueName, setIds }
    setLibrary((value) => ({ ...value, groups: [...value.groups, group] }))
    setGroupName('')
    setNotice(`Created study group “${uniqueName}” with ${setIds.length} sets.`)
  }

  function studyGroup(group: StudyGroup) {
    const memberIds = new Set(group.setIds)
    const groupSets = library.sets.filter((set) => memberIds.has(set.id))
    startReview(groupSets.flatMap((set) => set.cards), group.name)
  }

  function deleteGroup(groupId: string) {
    const group = library.groups.find((item) => item.id === groupId)
    if (!group || !window.confirm(`Delete the study group “${group.name}”? The flashcard sets will remain.`)) return
    setLibrary((value) => ({ ...value, groups: value.groups.filter((item) => item.id !== groupId) }))
    setNotice(`Deleted study group “${group.name}”.`)
  }

  function startReview(reviewCards: Flashcard[], title: string, startAt = 0, shuffled = false) {
    if (reviewCards.length === 0) return
    const ids = reviewCards.map((card) => card.id)
    const order = shuffled ? shuffle(ids) : [...ids.slice(startAt), ...ids.slice(0, startAt)]
    setReviewDeck(reviewCards)
    setReviewOrder(order)
    setReviewIndex(0)
    setReviewTitle(title)
    setIsReviewFlipped(false)
    setReviewResults({ correct: 0, incorrect: 0 })
    setIsReviewing(true)
  }

  function finishCard(correct: boolean) {
    setReviewResults((results) => ({
      ...results,
      [correct ? 'correct' : 'incorrect']: results[correct ? 'correct' : 'incorrect'] + 1,
    }))
    setReviewIndex((index) => index + 1)
    setIsReviewFlipped(false)
    setDragX(0)
  }

  function handleCardPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleCardPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return
    setDragX(event.clientX - gesture.current.x)
  }

  function handleCardPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = gesture.current
    if (!start || start.pointerId !== event.pointerId) return
    gesture.current = null
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) > 85 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 150)
      finishCard(deltaX > 0)
      return
    }
    setDragX(0)
  }

  function handleCardClick() {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    setIsReviewFlipped((flipped) => !flipped)
  }

  function exitReview() {
    setIsReviewing(false)
    setDragX(0)
  }

  function addCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = front.trim()
    const answer = back.trim()
    if ((!question && !frontImage && !frontDrawing) || (!answer && !backImage && !backDrawing) || !currentSet) return
    const wasEditing = editingCardId !== null
    const newCard: Flashcard = {
      id: editingCardId ?? makeId(), front: question, back: answer,
      ...(frontImage ? { frontImage } : {}), ...(backImage ? { backImage } : {}),
      ...(frontDrawing ? { frontDrawing } : {}), ...(backDrawing ? { backDrawing } : {}),
    }
    setLibrary((value) => ({ ...value, sets: value.sets.map((set) => set.id === currentSet.id ? {
      ...set,
      cards: wasEditing ? set.cards.map((card) => card.id === editingCardId ? newCard : card) : [...set.cards, newCard],
    } : set) }))
    setEditingCardId(null)
    setFront('')
    setBack('')
    setFrontImage('')
    setBackImage('')
    setFrontDrawing('')
    setBackDrawing('')
    setNotice(wasEditing ? `Changes saved in ${currentSet.name}.` : `Flashcard saved to ${currentSet.name}. Add another or finish when you're ready.`)
  }

  function openCardEditor() {
    setEditingCardId(null)
    setFront('')
    setBack('')
    setFrontImage('')
    setBackImage('')
    setFrontDrawing('')
    setBackDrawing('')
    setIsCreating(true)
  }

  function closeCardEditor() {
    setIsCreating(false)
    setEditingCardId(null)
    setFront('')
    setBack('')
    setFrontImage('')
    setBackImage('')
    setFrontDrawing('')
    setBackDrawing('')
  }

  function editCard(card: Flashcard) {
    setEditingCardId(card.id)
    setFront(card.front)
    setBack(card.back)
    setFrontImage(card.frontImage ?? '')
    setBackImage(card.backImage ?? '')
    setFrontDrawing(card.frontDrawing ?? '')
    setBackDrawing(card.backDrawing ?? '')
    setIsCreating(true)
  }

  async function handleImageUpload(event: FormEvent<HTMLInputElement>, side: 'front' | 'back') {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    try {
      const data = await readImage(file)
      if (side === 'front') setFrontImage(data)
      else setBackImage(data)
    } catch {
      setNotice('Unable to load that image. Try a different image file.')
    } finally {
      input.value = ''
    }
  }

  function exportCards() {
    if (!currentSet) return
    downloadJson({ version: 2, exportedAt: new Date().toISOString(), set: currentSet }, `${safeFileName(currentSet.name)}.json`)
    setNotice(`Exported set “${currentSet.name}”.`)
  }

  function exportAllSets() {
    downloadJson({ version: 2, exportedAt: new Date().toISOString(), sets: library.sets, groups: library.groups }, 'recall-all-sets.json')
    setNotice(`Exported all ${library.sets.length} sets and ${library.groups.length} study groups.`)
  }

  function downloadJson(payload: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function importCards(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const asSet = (value: unknown, fallbackName: string): FlashcardSet | null => {
        if (!value || typeof value !== 'object') return null
        const item = value as Record<string, unknown>
        if (!Array.isArray(item.cards) || !item.cards.every(isFlashcard)) return null
        return {
          id: makeId(),
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : fallbackName,
          cards: item.cards.map(normalizeCard).filter((card): card is Flashcard => card !== null).map((card) => ({ ...card, id: makeId() })),
        }
      }
      let incomingSets: FlashcardSet[] = []
      let incomingGroups: StudyGroup[] = []
      if (Array.isArray(parsed)) {
        const legacySet = { id: makeId(), name: 'Imported set', cards: parsed.map(normalizeCard).filter((card): card is Flashcard => card !== null).map((card) => ({ ...card, id: makeId() })) }
        incomingSets = [legacySet]
      } else if (parsed && typeof parsed === 'object' && 'sets' in parsed && Array.isArray(parsed.sets)) {
        const sourceSetIds = new Map<string, string>()
        incomingSets = parsed.sets.map((value, index) => {
          const imported = asSet(value, `Imported set ${index + 1}`)
          if (imported && value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') sourceSetIds.set(value.id, imported.id)
          return imported
        }).filter((set): set is FlashcardSet => set !== null)
        if (incomingSets.length !== parsed.sets.length) throw new Error('One or more sets in this file are invalid.')
        if ('groups' in parsed && Array.isArray(parsed.groups)) {
          incomingGroups = parsed.groups.flatMap((value): StudyGroup[] => {
            if (!value || typeof value !== 'object') return []
            const group = value as Record<string, unknown>
            if (typeof group.name !== 'string' || !Array.isArray(group.setIds)) return []
            const setIds = [...new Set(group.setIds.flatMap((id) => typeof id === 'string' && sourceSetIds.has(id) ? [sourceSetIds.get(id)!] : []))]
            return setIds.length >= 2 ? [{ id: makeId(), name: group.name, setIds }] : []
          })
        }
      } else if (parsed && typeof parsed === 'object' && 'set' in parsed) {
        const oneSet = asSet(parsed.set, 'Imported set')
        if (!oneSet) throw new Error('This file does not contain a valid flashcard set.')
        incomingSets = [oneSet]
      } else if (parsed && typeof parsed === 'object' && 'cards' in parsed && Array.isArray(parsed.cards)) {
        // Also accept the previous versioned export format and merge its cards into the active set.
        const incoming = parsed.cards.map(normalizeCard).filter((card): card is Flashcard => card !== null)
        if (incoming.length !== parsed.cards.length) throw new Error('This file contains invalid flashcards.')
        if (!currentSet) throw new Error('Create a set before importing cards.')
        const seen = new Set(cards.map((card) => cardSignature(card)))
        const unique = incoming.map((card) => ({ ...card, id: makeId() })).filter((card) => !seen.has(cardSignature(card)))
        setLibrary((value) => ({ ...value, sets: value.sets.map((set) => set.id === currentSet.id ? { ...set, cards: [...set.cards, ...unique] } : set) }))
        setNotice(`Imported ${unique.length} card${unique.length === 1 ? '' : 's'} into “${currentSet.name}”.`)
        return
      } else {
        throw new Error('This JSON file does not contain a valid set or collection.')
      }
      if (incomingSets.length === 0) throw new Error('No valid sets found in this file.')
      setLibrary((value) => {
        const names = new Set(value.sets.map((set) => set.name.toLocaleLowerCase()))
        const uniqueSets = incomingSets.map((set) => {
          let name = set.name
          let suffix = 2
          while (names.has(name.toLocaleLowerCase())) name = `${set.name} (${suffix++})`
          names.add(name.toLocaleLowerCase())
          return { ...set, name }
        })
        const groupNames = new Set(value.groups.map((group) => group.name.toLocaleLowerCase()))
        const uniqueGroups = incomingGroups.map((group) => {
          let name = group.name
          let suffix = 2
          while (groupNames.has(name.toLocaleLowerCase())) name = `${group.name} (${suffix++})`
          groupNames.add(name.toLocaleLowerCase())
          return { ...group, name }
        })
        return { sets: [...value.sets, ...uniqueSets], groups: [...value.groups, ...uniqueGroups], activeSetId: uniqueSets[0].id }
      })
      setNotice(`Imported ${incomingSets.length} set${incomingSets.length === 1 ? '' : 's'} and ${incomingGroups.length} study group${incomingGroups.length === 1 ? '' : 's'}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to read this JSON file.')
    } finally {
      input.value = ''
    }
  }

  function deleteCard(id: string) {
    setLibrary((value) => ({ ...value, sets: value.sets.map((set) => set.id === currentSet?.id ? { ...set, cards: set.cards.filter((card) => card.id !== id) } : set) }))
    setNotice('Flashcard deleted.')
  }

  function deleteSet(setId: string) {
    const target = library.sets.find((set) => set.id === setId)
    if (!target || !window.confirm(`Delete “${target.name}” and all ${target.cards.length} of its flashcards? This cannot be undone.`)) return
    const remainingSets = library.sets.filter((set) => set.id !== setId)
    const replacement = remainingSets.length === 0 ? { id: makeId(), name: 'My first set', cards: [] } : null
    const nextSets = replacement ? [replacement] : remainingSets
    const nextActiveSetId = library.activeSetId === setId ? nextSets[0].id : library.activeSetId
    const groups = library.groups
      .map((group) => ({ ...group, setIds: group.setIds.filter((id) => id !== setId) }))
      .filter((group) => group.setIds.length >= 2)
    setLibrary({ sets: nextSets, groups, activeSetId: nextActiveSetId })
    setSelectedSetIds((value) => value.filter((id) => id !== setId))
    if (currentSet?.id === setId && isCreating) closeCardEditor()
    setNotice(`Deleted “${target.name}” and its flashcards.`)
  }

  function createSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const baseName = setName.trim()
    if (!baseName) return
    const takenNames = new Set(library.sets.map((set) => set.name.toLocaleLowerCase()))
    let name = baseName
    let suffix = 2
    while (takenNames.has(name.toLocaleLowerCase())) name = `${baseName} (${suffix++})`
    const set = { id: makeId(), name, cards: [] }
    setLibrary((value) => ({ ...value, sets: [...value.sets, set], activeSetId: set.id }))
    setSelectedSetIds((value) => [...value, set.id])
    setSetName('')
    setNotice(`Created “${name}”.`)
  }

  function switchSet(setId: string) {
    setLibrary((value) => ({ ...value, activeSetId: setId }))
    setFront('')
    setBack('')
    setFrontImage('')
    setBackImage('')
    setFrontDrawing('')
    setBackDrawing('')
  }

  function setSelected(setId: string, selected: boolean) {
    setSelectedSetIds((value) => selected ? [...new Set([...value, setId])] : value.filter((id) => id !== setId))
  }

  const reviewFaceText = currentReviewCard ? (isReviewFlipped ? currentReviewCard.back : currentReviewCard.front) : ''
  const reviewFaceImage = currentReviewCard ? (isReviewFlipped ? currentReviewCard.backImage : currentReviewCard.frontImage) : undefined
  const reviewFaceDrawing = currentReviewCard ? (isReviewFlipped ? currentReviewCard.backDrawing : currentReviewCard.frontDrawing) : undefined

  return (
    isReviewing ? (
      <div className="review-mode">
        <header className="review-topbar">
          <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); exitReview() }} aria-label="Return to Recall">
            <span className="brand-mark"><Icon name="spark" size={20} /></span>
            <span>recall<span className="brand-period">.</span></span>
          </a>
          <div className="review-session-label"><span className="session-live-dot" /> STUDY SESSION</div>
          <button className="button button-quiet exit-review" type="button" onClick={exitReview}>Exit review <Icon name="close" size={17} /></button>
        </header>

        <main className="review-main">
          {reviewIndex < reviewOrder.length && currentReviewCard ? (
            <>
              <div className="review-toolbar">
                <div className="review-position"><span>{reviewTitle.toLocaleUpperCase()}</span><strong>{String(reviewIndex + 1).padStart(2, '0')} <i>/</i> {String(reviewOrder.length).padStart(2, '0')}</strong></div>
                <button className="button button-outline shuffle-button" type="button" onClick={() => startReview(reviewDeck, reviewTitle, 0, true)}><Icon name="shuffle" size={16} /> Shuffle &amp; restart</button>
              </div>
              <div className="review-progress"><span style={{ width: `${((reviewIndex + 1) / reviewOrder.length) * 100}%` }} /></div>

              <div className="review-stage">
                <div className="swipe-direction direction-left"><span><Icon name="close" size={15} /></span><small>NOT YET</small></div>
                <button
                  className={`review-card ${isReviewFlipped ? 'is-flipped' : ''} ${dragX > 10 ? 'drag-right' : ''} ${dragX < -10 ? 'drag-left' : ''} ${dragX !== 0 ? 'is-dragging' : ''}`}
                  type="button"
                  style={{ transform: `translate3d(${dragX}px, 0, 0) rotate(${dragX * 0.035}deg)` }}
                  onClick={handleCardClick}
                  onPointerDown={handleCardPointerDown}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerEnd}
                  onPointerCancel={() => { gesture.current = null; setDragX(0) }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') { event.preventDefault(); finishCard(false) }
                    if (event.key === 'ArrowRight') { event.preventDefault(); finishCard(true) }
                  }}
                  aria-label={`${isReviewFlipped ? 'Answer' : 'Question'}: ${reviewFaceText || 'image or drawing'}. Tap to flip, swipe right for correct, or left for incorrect.`}
                >
                  {dragX > 22 && <span className="swipe-stamp stamp-correct">CORRECT <Icon name="check" size={16} /></span>}
                  {dragX < -22 && <span className="swipe-stamp stamp-incorrect">NOT YET <Icon name="close" size={16} /></span>}
                  <span className="review-card-label"><span className="review-label-dot" />{isReviewFlipped ? 'ANSWER' : 'QUESTION'}</span>
                  <span className="review-card-content">
                    {reviewFaceText && <span>{reviewFaceText}</span>}
                    {reviewFaceImage && <img className="review-attachment" src={reviewFaceImage} alt={`${isReviewFlipped ? 'Answer' : 'Question'} image`} />}
                    {reviewFaceDrawing && <img className="review-attachment review-drawing" src={reviewFaceDrawing} alt={`${isReviewFlipped ? 'Answer' : 'Question'} drawing`} />}
                  </span>
                  <span className="review-card-hint"><Icon name="rotate" size={15} /> Tap to flip</span>
                </button>
                <div className="swipe-direction direction-right"><span><Icon name="check" size={15} /></span><small>GOT IT</small></div>
              </div>

              <div className="review-actions">
                <button className="grade-button grade-incorrect" type="button" onClick={() => finishCard(false)}><span className="grade-icon"><Icon name="close" size={19} /></span><span><strong>Incorrect</strong><small>Swipe left</small></span><kbd>←</kbd></button>
                <p className="review-action-hint">How well did you remember?</p>
                <button className="grade-button grade-correct" type="button" onClick={() => finishCard(true)}><span className="grade-icon"><Icon name="check" size={19} /></span><span><strong>Correct</strong><small>Swipe right</small></span><kbd>→</kbd></button>
              </div>
              <div className="review-score"><span><b>{reviewResults.correct}</b> correct</span><i /> <span><b>{reviewResults.incorrect}</b> to revisit</span></div>
            </>
          ) : (
            <section className="review-complete">
              <span className="complete-spark"><Icon name="spark" size={30} /></span>
              <p className="eyebrow">SESSION COMPLETE</p>
              <h1>Nice work showing up.</h1>
              <p className="complete-copy">You reviewed all {reviewOrder.length} {reviewOrder.length === 1 ? 'card' : 'cards'}. Every recall makes it stick a little more.</p>
              <div className="complete-stats">
                <div><strong>{reviewResults.correct}</strong><span>Correct</span></div>
                <div><strong>{reviewResults.incorrect}</strong><span>To revisit</span></div>
              </div>
              <div className="complete-actions">
                <button className="button button-outline" type="button" onClick={() => startReview(reviewDeck, reviewTitle, 0, true)}><Icon name="shuffle" size={16} /> Shuffle &amp; review again</button>
                <button className="button button-primary" type="button" onClick={exitReview}>Back to my cards</button>
              </div>
            </section>
          )}
        </main>
        <footer className="review-footer"><span>Take your time. Learning is a practice.</span><span><Icon name="spark" size={14} /> Recall</span></footer>
      </div>
    ) : isCreating ? (
      <div className="app-shell editor-shell">
        <header className="topbar">
          <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); closeCardEditor() }} aria-label="Return to sets">
            <span className="brand-mark"><Icon name="spark" size={20} /></span>
            <span>recall<span className="brand-period">.</span></span>
          </a>
          <button className="button button-outline" type="button" onClick={closeCardEditor}>Done <Icon name="arrow" size={16} /></button>
        </header>
        <main className="editor-main">
          <div className="editor-heading">
            <p className="eyebrow">ADD TO {currentSet?.name.toLocaleUpperCase() ?? 'YOUR SET'}</p>
            <h1>{editingCardId ? 'Edit a flashcard' : 'Create a flashcard'}</h1>
            <p>{editingCardId ? 'Update the question, answer, image, or drawing.' : 'Write, upload, or draw on either side. Save as many cards as you need.'}</p>
          </div>
          <article className="create-panel panel editor-panel">
            <div className="section-heading create-heading">
              <div><p className="eyebrow">{editingCardId ? 'EDIT CARD' : 'NEW CARD'}</p><h2>Question &amp; answer</h2></div>
              <span className="plus-badge"><Icon name="plus" size={19} /></span>
            </div>
            <form className="card-form" onSubmit={addCard}>
              <label htmlFor="question">Question <span>FRONT OF CARD</span></label>
              <textarea id="question" value={front} onChange={(event) => setFront(event.target.value)} placeholder="Write a question, or add an image or drawing..." rows={3} />
              <input ref={frontImageInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => handleImageUpload(event, 'front')} />
              <div className="media-tools">
                <button className="media-button" type="button" onClick={() => frontImageInput.current?.click()}><Icon name="upload" size={15} /> Add image</button>
                {frontImage && <button className="media-button remove-media" type="button" onClick={() => setFrontImage('')}>Remove image</button>}
              </div>
              {frontImage && <img className="attached-image-preview" src={frontImage} alt="Question side attachment preview" />}
              <DrawingPad label="question" value={frontDrawing} onChange={setFrontDrawing} />
              <label htmlFor="answer">Answer <span>BACK OF CARD</span></label>
              <textarea id="answer" value={back} onChange={(event) => setBack(event.target.value)} placeholder="Type an answer, attach a picture, or sketch it..." rows={3} />
              <input ref={backImageInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => handleImageUpload(event, 'back')} />
              <div className="media-tools">
                <button className="media-button" type="button" onClick={() => backImageInput.current?.click()}><Icon name="upload" size={15} /> Add image</button>
                {backImage && <button className="media-button remove-media" type="button" onClick={() => setBackImage('')}>Remove image</button>}
              </div>
              {backImage && <img className="attached-image-preview" src={backImage} alt="Answer side attachment preview" />}
              <DrawingPad label="answer" value={backDrawing} onChange={setBackDrawing} />
              <div className="editor-form-actions">
                <button className="button button-outline" type="button" onClick={closeCardEditor}>{editingCardId ? 'Cancel editing' : 'Done adding cards'}</button>
                <button className="button button-primary add-button" type="submit" disabled={!currentSet || (!front.trim() && !frontImage && !frontDrawing) || (!back.trim() && !backImage && !backDrawing)}><Icon name={editingCardId ? 'edit' : 'plus'} size={17} /> {editingCardId ? 'Save changes' : 'Save card'}</button>
              </div>
            </form>
          </article>
          <p className="notice" role="status" aria-live="polite">{notice}</p>
        </main>
        <footer className="footer"><span>Made for curious minds.</span><span><Icon name="spark" size={14} /> Keep showing up.</span></footer>
      </div>
    ) : (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Recall home">
          <span className="brand-mark"><Icon name="spark" size={20} /></span>
          <span>recall<span className="brand-period">.</span></span>
        </a>
        <nav className="top-actions" aria-label="Flashcard set actions">
          <button className="button button-primary header-add-button" type="button" onClick={openCardEditor} disabled={!currentSet} aria-label="Add flashcards" title="Add flashcards">
            <Icon name="plus" size={18} /> <span>Add cards</span>
          </button>
          <button className="button button-quiet" type="button" onClick={() => importInput.current?.click()}>
            <Icon name="upload" /> <span>Import</span>
          </button>
          <input ref={importInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={importCards} />
          <button className="button button-quiet" type="button" onClick={exportCards} disabled={!currentSet} title="Export the selected set">
            <Icon name="download" /> <span>Export</span>
          </button>
          <button className="button button-quiet export-all-button" type="button" onClick={exportAllSets} title="Export all sets">
            <Icon name="layers" /> <span>All sets</span>
          </button>
          <span className="top-divider" />
          <div className="avatar" aria-label="Your study space">S</div>
        </nav>
      </header>

      <main id="home">
        <section className="sets-section" aria-labelledby="sets-title">
          <div className="collection-heading">
            <div><p className="eyebrow">ORGANIZE YOUR STUDY</p><h2 id="sets-title">Flashcard sets <span className="collection-total">{library.sets.length}</span></h2></div>
            <button className="button button-primary sets-review-button" type="button" onClick={() => startReview(selectedCards, selectedSets.map((set) => set.name).join(' + '))} disabled={selectedCards.length === 0}>
              Review selected ({selectedCards.length}) <Icon name="arrow" size={15} />
            </button>
          </div>
          <form className="new-set-form" onSubmit={createSet}>
            <input value={setName} onChange={(event) => setSetName(event.target.value)} aria-label="New set name" placeholder="Name a new set..." />
            <button className="button button-outline" type="submit" disabled={!setName.trim()}><Icon name="plus" size={16} /> Create set</button>
          </form>
          <div className="sets-grid">
            {library.sets.map((set) => (
              <article className={`set-tile ${set.id === currentSet?.id ? 'is-active' : ''}`} key={set.id}>
                <button className="set-tile-main" type="button" onClick={() => switchSet(set.id)}>
                  <span className="set-tile-icon"><Icon name="layers" size={19} /></span>
                  <span className="set-tile-copy"><strong>{set.name}</strong><small>{set.cards.length} {set.cards.length === 1 ? 'card' : 'cards'}{set.id === currentSet?.id ? ' · Editing' : ''}</small></span>
                </button>
                <label className="set-checkbox" title={`Include ${set.name} in a combined review`}>
                  <input type="checkbox" checked={selectedSetIds.includes(set.id)} onChange={(event) => setSelected(set.id, event.target.checked)} />
                  <span>Select</span>
                </label>
                <button className="set-export" type="button" onClick={() => { downloadJson({ version: 2, exportedAt: new Date().toISOString(), set }, `${safeFileName(set.name)}.json`); setNotice(`Exported set “${set.name}”.`) }} aria-label={`Export ${set.name}`} title="Export this set"><Icon name="download" size={16} /></button>
                <button className="set-delete" type="button" onClick={() => deleteSet(set.id)} aria-label={`Delete ${set.name}`} title="Delete study set"><Icon name="trash" size={16} /></button>
              </article>
            ))}
          </div>
          <div className="set-review-actions">
            <button className="subtle-action" type="button" onClick={() => startReview(library.sets.flatMap((set) => set.cards), 'All sets')} disabled={library.sets.every((set) => set.cards.length === 0)}>Review all sets <Icon name="arrow" size={15} /></button>
            <button className="subtle-action" type="button" onClick={exportAllSets}>Export all sets <Icon name="download" size={15} /></button>
          </div>
          <section className="groups-panel" aria-labelledby="groups-title">
            <div className="groups-heading">
              <div><p className="eyebrow">STUDY TOGETHER</p><h3 id="groups-title">Study groups <span className="collection-total">{library.groups.length}</span></h3></div>
            </div>
            <p className="groups-description">Choose at least two sets above to bundle them into a group you can review as one deck.</p>
            <form className="group-create-form" onSubmit={createGroup}>
              <input value={groupName} onChange={(event) => setGroupName(event.target.value)} aria-label="Study group name" placeholder="e.g. Biology final" />
              <button className="button button-outline" type="submit" disabled={!groupName.trim() || selectedSets.length < 2}><Icon name="plus" size={15} /> Create from {selectedSets.length} selected</button>
            </form>
            {library.groups.length > 0 ? (
              <div className="groups-list">
                {library.groups.map((group) => {
                  const members = library.sets.filter((set) => group.setIds.includes(set.id))
                  const groupCardCount = members.reduce((count, set) => count + set.cards.length, 0)
                  return (
                    <article className="group-row" key={group.id}>
                      <span className="group-icon"><Icon name="layers" size={18} /></span>
                      <div className="group-info"><strong>{group.name}</strong><small>{members.map((set) => set.name).join(' · ')} · {groupCardCount} {groupCardCount === 1 ? 'card' : 'cards'}</small></div>
                      <button className="button button-primary group-review-button" type="button" onClick={() => studyGroup(group)} disabled={groupCardCount === 0}>Review group <Icon name="arrow" size={15} /></button>
                      <button className="group-delete-button" type="button" onClick={() => deleteGroup(group.id)} aria-label={`Delete ${group.name}`} title="Delete study group"><Icon name="trash" size={16} /></button>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="groups-empty">No study groups yet. Create one to combine related sets.</div>
            )}
          </section>
        </section>

        <section className="collection-section" aria-labelledby="collection-title">
          <div className="collection-heading">
            <div><p className="eyebrow">CURRENT SET · {currentSet?.name.toLocaleUpperCase()}</p><h2 id="collection-title">Cards in this set <span className="collection-total">{cards.length}</span></h2></div>
            <div className="collection-actions">
              <button className="add-card-icon" type="button" onClick={openCardEditor} disabled={!currentSet} aria-label="Add flashcards" title="Add flashcards"><Icon name="plus" size={20} /></button>
              {cards.length > 0 && <button className="subtle-action" type="button" onClick={() => currentSet && startReview(cards, currentSet.name)}>Study this set <Icon name="arrow" size={15} /></button>}
            </div>
          </div>
          {cards.length > 0 ? (
            <div className="card-list">
              {cards.map((card, index) => (
                <article className="list-card" key={card.id}>
                  <button className="list-card-main" type="button" onClick={() => currentSet && startReview(cards, currentSet.name, index)}>
                    <span className="list-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="list-copy"><strong>{card.front}</strong><small>{card.back}</small></span>
                    <span className="list-chevron"><Icon name="chevron" size={18} /></span>
                  </button>
                  <button className="edit-button" type="button" onClick={() => editCard(card)} aria-label={`Edit flashcard ${card.front || index + 1}`} title="Edit flashcard"><Icon name="edit" size={16} /></button>
                  <button className="delete-button" type="button" onClick={() => deleteCard(card.id)} aria-label={`Delete flashcard ${card.front || index + 1}`} title="Delete flashcard"><Icon name="trash" size={16} /></button>
                </article>
              ))}
            </div>
          ) : (
            <div className="collection-empty"><span className="tiny-spark"><Icon name="spark" size={17} /></span><span>No flashcards yet — the best time to start is now.</span></div>
          )}
        </section>
        <p className="notice" role="status" aria-live="polite">{notice}</p>
      </main>

      <footer className="footer"><span>Made for curious minds.</span><span><Icon name="spark" size={14} /> Keep showing up.</span></footer>
    </div>
    )
  )
}

export default App
