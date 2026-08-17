import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { t } from './locales.ts'
import css from './sidebar.module.css'

export interface WritingEditorProps {
  value: string
  onChange(value: string): void
  onSave(): void
}

interface CommandButtonProps {
  label: string
  active?: boolean
  disabled?: boolean
  children: string
  run(editor: Editor): void
  editor: Editor
}

function CommandButton(props: CommandButtonProps) {
  const { label, active = false, disabled = false, children, run, editor } = props
  return (
    <button
      type="button"
      className={css.writingToolButton}
      data-active={active || undefined}
      disabled={disabled}
      aria-label={label}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault()
        run(editor)
      }}
    >
      {children}
    </button>
  )
}

/**
 * Markdown-native Tiptap surface. Markdown remains the disk and parent-state
 * truth; the editor only owns the active rich-text transaction stream.
 */
export function WritingEditor(props: WritingEditorProps) {
  const { value, onChange, onSave } = props
  const emitted = useRef(value)
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown.configure({ indentation: { style: 'space', size: 2 } }),
    ],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: css.writingProse ?? '',
        spellcheck: 'true',
      },
      handleKeyDown: (_view, event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return false
        event.preventDefault()
        saveRef.current()
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown()
      emitted.current = markdown
      onChange(markdown)
    },
  })

  // A source-mode edit can update the shared Markdown while this component
  // remains mounted. Do not reset an actively edited Tiptap transaction.
  useEffect(() => {
    if (editor === null || editor.isFocused || value === emitted.current) return
    emitted.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  if (editor === null) return <div className={css.editorPlaceholder}>{t('loading')}</div>

  return (
    <div className={css.writingEditor}>
      <div className={css.writingToolbar} role="toolbar" aria-label={t('writingToolbar')}>
        <div className={css.writingToolGroup}>
          <CommandButton editor={editor} label={t('undo')} disabled={!editor.can().chain().focus().undo().run()} run={e => { e.chain().focus().undo().run() }}>↶</CommandButton>
          <CommandButton editor={editor} label={t('redo')} disabled={!editor.can().chain().focus().redo().run()} run={e => { e.chain().focus().redo().run() }}>↷</CommandButton>
        </div>
        <div className={css.writingToolGroup}>
          <CommandButton editor={editor} label={t('paragraph')} active={editor.isActive('paragraph')} run={e => { e.chain().focus().setParagraph().run() }}>P</CommandButton>
          <CommandButton editor={editor} label={t('headingOne')} active={editor.isActive('heading', { level: 1 })} run={e => { e.chain().focus().toggleHeading({ level: 1 }).run() }}>H1</CommandButton>
          <CommandButton editor={editor} label={t('headingTwo')} active={editor.isActive('heading', { level: 2 })} run={e => { e.chain().focus().toggleHeading({ level: 2 }).run() }}>H2</CommandButton>
        </div>
        <div className={css.writingToolGroup}>
          <CommandButton editor={editor} label={t('bold')} active={editor.isActive('bold')} run={e => { e.chain().focus().toggleBold().run() }}>B</CommandButton>
          <CommandButton editor={editor} label={t('italic')} active={editor.isActive('italic')} run={e => { e.chain().focus().toggleItalic().run() }}>I</CommandButton>
          <CommandButton editor={editor} label={t('strike')} active={editor.isActive('strike')} run={e => { e.chain().focus().toggleStrike().run() }}>S</CommandButton>
          <CommandButton editor={editor} label={t('inlineCode')} active={editor.isActive('code')} run={e => { e.chain().focus().toggleCode().run() }}>{'<>'}</CommandButton>
        </div>
        <div className={css.writingToolGroup}>
          <CommandButton editor={editor} label={t('bulletList')} active={editor.isActive('bulletList')} run={e => { e.chain().focus().toggleBulletList().run() }}>-</CommandButton>
          <CommandButton editor={editor} label={t('orderedList')} active={editor.isActive('orderedList')} run={e => { e.chain().focus().toggleOrderedList().run() }}>1.</CommandButton>
          <CommandButton editor={editor} label={t('blockquote')} active={editor.isActive('blockquote')} run={e => { e.chain().focus().toggleBlockquote().run() }}>"</CommandButton>
        </div>
      </div>
      <div className={css.writingScroll}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
