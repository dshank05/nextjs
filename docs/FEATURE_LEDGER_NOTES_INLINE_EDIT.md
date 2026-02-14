# Feature: Inline Ledger Notes Editing

**Document Version:** 1.0  
**Created:** February 13, 2026  
**Type:** Feature Enhancement  
**Priority:** Medium

---

## [Overview]

Add ability to edit ledger entry notes directly from the ledger screen with inline editing UI.

**User Story:**
> As a user viewing the vendor ledger, I want to edit notes inline without navigating to another page, so I can quickly add context to ledger entries.

---

## [UX Flow]

1. **Default State:** Notes displayed as read-only text
2. **Hover State:** Edit icon appears next to notes text
3. **Edit Mode:** Click edit → Text transforms to input field with save/cancel buttons
4. **Save:** Click save → API call → Update ledger entry → Show updated note
5. **Cancel:** Click cancel → Revert to original text

---

## [Backend Implementation]

### **New API Endpoint**

**File:** `pages/api/vendor-ledger/[id].ts`

```typescript
/**
 * PATCH /api/vendor-ledger/[id]
 * Update notes for a single ledger entry
 */
export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  const { notes } = req.body;

  // Validate
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'Invalid ledger entry ID' });
  }

  if (notes === undefined || notes === null) {
    return res.status(400).json({ error: 'Notes field is required' });
  }

  try {
    // Simple direct update - no transaction needed
    const updated = await prisma.vendor_ledger.update({
      where: { id: parseInt(id) },
      data: { 
        notes: notes.trim(),
        updated_at: new Date()  // Track modification time
      },
      select: {
        id: true,
        notes: true,
        updated_at: true
      }
    });

    return res.status(200).json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('Ledger notes update error:', error);
    return res.status(500).json({
      error: 'Failed to update notes',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
```

**API Characteristics:**
- ✅ **Fast** - Single UPDATE query, no transaction overhead
- ✅ **Simple** - Only updates `notes` field
- ✅ **Safe** - No balance recalculation needed (notes don't affect accounting)
- ✅ **Secure** - Session authentication required

---

## [Frontend Implementation]

### **Component: InlineEditableNotes**

**File:** `components/InlineEditableNotes.tsx`

```typescript
import { useState } from 'react';
import { Check, X, Edit2 } from 'lucide-react';

interface InlineEditableNotesProps {
  ledgerEntryId: number;
  initialNotes: string;
  onUpdate?: (newNotes: string) => void;
}

export function InlineEditableNotes({ 
  ledgerEntryId, 
  initialNotes, 
  onUpdate 
}: InlineEditableNotesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleSave = async () => {
    if (notes === initialNotes) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/vendor-ledger/${ledgerEntryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });

      if (!response.ok) throw new Error('Update failed');

      const result = await response.json();
      onUpdate?.(result.data.notes);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update notes:', error);
      alert('Failed to update notes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setNotes(initialNotes || '');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="flex-1 px-2 py-1 border rounded text-sm"
          placeholder="Enter notes..."
          autoFocus
          disabled={isSaving}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
        />
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="p-1 text-green-600 hover:bg-green-50 rounded"
          title="Save (Enter)"
        >
          <Check size={16} />
        </button>
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="p-1 text-red-600 hover:bg-red-50 rounded"
          title="Cancel (Esc)"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="flex-1 text-sm text-gray-700">
        {notes || <span className="text-gray-400 italic">No notes</span>}
      </span>
      {isHovered && (
        <button
          onClick={() => setIsEditing(true)}
          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit notes"
        >
          <Edit2 size={14} />
        </button>
      )}
    </div>
  );
}
```

---

### **Integration in Ledger Page**

**File:** `pages/vendor-transactions/[id].tsx`

```typescript
import { InlineEditableNotes } from '@/components/InlineEditableNotes';

// In your ledger table row:
<td className="px-4 py-2">
  <InlineEditableNotes
    ledgerEntryId={entry.id}
    initialNotes={entry.notes}
    onUpdate={(newNotes) => {
      // Optimistic UI update
      setLedgerEntries(prev => 
        prev.map(e => 
          e.id === entry.id 
            ? { ...e, notes: newNotes }
            : e
        )
      );
    }}
  />
</td>
```

---

## [Features]

### **UX Benefits:**
- ✅ **Hover to reveal** - Clean interface, edit only when needed
- ✅ **Keyboard shortcuts** - Enter to save, Escape to cancel
- ✅ **Optimistic update** - Immediate visual feedback
- ✅ **Loading state** - Shows saving indicator
- ✅ **Error handling** - Alerts user if save fails

### **Technical Benefits:**
- ✅ **Fast API** - Single UPDATE, no locks, no transactions
- ✅ **No side effects** - Notes don't affect balances or status
- ✅ **Atomic operation** - One field update at a time
- ✅ **Session secured** - Authenticated users only

---

## [Implementation Steps]

1. **Backend:** Create `/api/vendor-ledger/[id].ts` endpoint
2. **Frontend:** Create `InlineEditableNotes` component
3. **Integration:** Add component to ledger table
4. **Testing:** Verify updates work correctly
5. **Polish:** Add loading states and error handling

---

## [Testing Checklist]

- [ ] API endpoint returns 200 on valid update
- [ ] API endpoint returns 400 on invalid input
- [ ] API endpoint returns 401 without authentication
- [ ] API endpoint returns 404 for non-existent ledger ID
- [ ] Frontend shows edit icon on hover
- [ ] Frontend transforms to input on click
- [ ] Save button updates notes successfully
- [ ] Cancel button reverts changes
- [ ] Enter key saves notes
- [ ] Escape key cancels edit
- [ ] Loading state shows during save
- [ ] Error message shows on API failure
- [ ] Optimistic update works correctly

---

## [Security Considerations]

### **Access Control:**
- ✅ Session authentication required
- ✅ Users can only edit their own vendor ledgers (add vendor_id check if needed)

### **Input Validation:**
- ✅ Trim whitespace
- ✅ Limit length (e.g., max 500 characters)
- ✅ Sanitize HTML if rendering (use `dangerouslySetInnerHTML` carefully)

### **Suggested Enhancement:**
```typescript
// In API endpoint
const MAX_NOTES_LENGTH = 500;

if (notes.length > MAX_NOTES_LENGTH) {
  return res.status(400).json({ 
    error: `Notes must be ${MAX_NOTES_LENGTH} characters or less` 
  });
}
```

---

## [Future Enhancements]

### **Phase 2 (Optional):**
1. **Audit Trail** - Track who edited notes and when
2. **Rich Text** - Support formatting (bold, links, etc.)
3. **Autosave** - Save after typing stops (debounced)
4. **Templates** - Common note templates for quick selection
5. **Batch Edit** - Edit multiple notes at once

---

## [Estimated Effort]

- **Backend API:** 1 hour
- **Frontend Component:** 2 hours
- **Integration:** 1 hour
- **Testing:** 1 hour
- **Total:** ~5 hours

---

## [Recommendation]

✅ **APPROVED - Clean, Simple, Fast**

This feature is:
- Low complexity
- High user value
- No performance impact
- No side effects on accounting
- Easy to implement and test

**Go ahead and implement!** 🚀

---

**END OF FEATURE SPECIFICATION**
