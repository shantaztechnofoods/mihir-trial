-- Rollback for 068. The bucket itself is NEVER dropped (it holds machine
-- photos/files; deleting it would lose data). This only lifts the MIME list so
-- any file type is accepted again (pre-068 behaviour of a hand-made bucket).
UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id = 'machine-attachments';
