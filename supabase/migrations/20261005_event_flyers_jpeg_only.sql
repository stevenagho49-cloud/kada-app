-- Flyers are resized and converted to JPEG in the browser before upload
-- (src/lib/flyerImage.js). The bucket enforces the same rule so a stale tab or
-- direct API upload cannot store a full-size PNG/photo. 2 MB is well above a
-- 1600x2400 JPEG at quality 0.88. Existing objects are not affected.
update storage.buckets
  set allowed_mime_types = array['image/jpeg'], file_size_limit = 2097152
  where id = 'event-flyers';
