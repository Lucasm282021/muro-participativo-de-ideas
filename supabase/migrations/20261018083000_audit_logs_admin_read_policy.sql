create policy "Admins can read audit logs"
  on public.audit_logs
  for select
  to authenticated
  using (public.is_admin());
