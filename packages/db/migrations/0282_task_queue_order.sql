-- Each assignee's tasks in a queue, in the order they reached them (ADR doug-0022): lowest first, null with no assignee.
ALTER TABLE "issues" ADD COLUMN "queue_position" double precision;--> statement-breakpoint
-- Open tasks already assigned line up by when they were assigned (their last "assigned" event), or made when none.
UPDATE "issues" AS i SET "queue_position" = q.position
FROM (
  SELECT t.id, row_number() OVER (
    PARTITION BY t.org_id, t.assignee_type, t.assignee_id
    ORDER BY coalesce(
      (SELECT max(a.created_at) FROM "issue_activity" a WHERE a.issue_id = t.id AND a.event = 'assigned'),
      t.created_at
    ), t.number
  )::double precision AS position
  FROM "issues" t
  WHERE t.assignee_id IS NOT NULL AND t.status IN ('todo', 'in_progress', 'in_review')
) AS q
WHERE i.id = q.id;
