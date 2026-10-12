-- The 3D Quote Tool has no code yet (the `3D Modeling/` folder is a placeholder),
-- so its plan must not be sold as if quotes land in the portal. Hidden until it ships.
update public.plans set published = false, updated_at = now() where name = '3D Quote Tool';
