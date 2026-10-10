import { httpJson, HttpError } from '../api/httpClient';
import { unwrapPagedResults, type PagedResponse } from '../api/pagedResults';
import { getBackendAccessToken } from './backendAuth';

export type WeekPhase = 'every' | 'upper' | 'lower';

export type CampusBuildingDto = {
  id: number;
  name: string;
  short_code: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  boundary: [number, number][];
  sort_order: number;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffScheduleSlotDto = {
  id: number;
  owner_key: string;
  week_phase: WeekPhase;
  week_phase_label?: string;
  applies_this_calendar_week?: boolean;
  weekday: number;
  start_time: string;
  end_time: string;
  building: CampusBuildingDto | null;
  building_name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  title: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ScheduleWeekInfoDto = {
  iso_week: number;
  current_week_phase: 'upper' | 'lower';
  current_week_phase_label_uz: string;
};

export type StaffLocationPingDto = {
  id: number;
  owner_key: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
  client_ts_ms: number | null;
};

export type StaffLocationAlertDto = {
  id: number;
  owner_key: string;
  slot: number | null;
  building_name: string;
  expected_lat: number;
  expected_lng: number;
  actual_lat: number;
  actual_lng: number;
  distance_m: number;
  radius_m: number;
  slot_start: string | null;
  slot_end: string | null;
  message: string;
  created_at: string;
};

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBackendAccessToken();
  if (!token) throw new Error('no-backend-token');
  return { Authorization: `Bearer ${token}` };
}

export async function postStaffLocationPing(body: {
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  client_ts_ms?: number | null;
}): Promise<{ ok: boolean; alerts_created: number; alert_ids: number[] }> {
  return httpJson(`${apiBaseUrl()}/v1/staff/location-ping/`, {
    method: 'POST',
    headers: await authHeaders(),
    body: {
      ...body,
      client_kind: 'mobile',
    },
    timeoutMs: 20000,
  });
}

export async function getMyStaffSchedule(): Promise<StaffScheduleSlotDto[]> {
  const rows = await httpJson<StaffScheduleSlotDto[]>(`${apiBaseUrl()}/v1/staff/schedule/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function getScheduleWeekInfo(): Promise<ScheduleWeekInfoDto> {
  return httpJson<ScheduleWeekInfoDto>(`${apiBaseUrl()}/v1/staff/schedule-week-info/`, {
    headers: await authHeaders(),
    timeoutMs: 15000,
  });
}

export async function listCampusBuildings(): Promise<CampusBuildingDto[]> {
  const rows = await httpJson<CampusBuildingDto[]>(`${apiBaseUrl()}/v1/staff/buildings/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function listAdminCampusBuildings(): Promise<CampusBuildingDto[]> {
  const rows = await httpJson<CampusBuildingDto[]>(`${apiBaseUrl()}/v1/admin/campus-buildings/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function createAdminCampusBuilding(
  body: Partial<Pick<CampusBuildingDto, 'name' | 'short_code' | 'latitude' | 'longitude' | 'radius_m' | 'boundary' | 'sort_order' | 'notes' | 'is_active'>>
): Promise<CampusBuildingDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/campus-buildings/`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function patchAdminCampusBuilding(
  id: number,
  body: Partial<Pick<CampusBuildingDto, 'name' | 'short_code' | 'latitude' | 'longitude' | 'radius_m' | 'boundary' | 'sort_order' | 'notes' | 'is_active'>>
): Promise<CampusBuildingDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/campus-buildings/${id}/`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function deleteAdminCampusBuilding(id: number): Promise<void> {
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/campus-buildings/${id}/`, {
    method: 'DELETE',
    headers: await authHeaders(),
    timeoutMs: 15000,
  });
}

export async function listAdminStaffSchedule(ownerKey?: string): Promise<StaffScheduleSlotDto[]> {
  const q = ownerKey?.trim() ? `?owner_key=${encodeURIComponent(ownerKey.trim())}` : '';
  const rows = await httpJson<StaffScheduleSlotDto[]>(`${apiBaseUrl()}/v1/admin/staff-schedule/${q}`, {
    headers: await authHeaders(),
    timeoutMs: 30000,
  });
  return Array.isArray(rows) ? rows : [];
}

export async function createAdminStaffSchedule(
  body: Omit<StaffScheduleSlotDto, 'id' | 'created_at' | 'updated_at'>
): Promise<StaffScheduleSlotDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-schedule/`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function patchAdminStaffSchedule(
  id: number,
  body: Partial<Omit<StaffScheduleSlotDto, 'id' | 'created_at' | 'updated_at'>>
): Promise<StaffScheduleSlotDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-schedule/${id}/`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body,
    timeoutMs: 20000,
  });
}

export async function deleteAdminStaffSchedule(id: number): Promise<void> {
  await httpJson<unknown>(`${apiBaseUrl()}/v1/admin/staff-schedule/${id}/`, {
    method: 'DELETE',
    headers: await authHeaders(),
    timeoutMs: 15000,
  });
}

export type BulkScheduleSlotPayload = {
  weekday: number;
  start_time: string;
  end_time: string;
  building_id?: number;
  building_name?: string;
  latitude?: number;
  longitude?: number;
  radius_m?: number;
  title?: string;
};

export async function bulkReplaceAdminStaffSchedule(body: {
  owner_key: string;
  week_phase: WeekPhase;
  replace_existing: boolean;
  slots: BulkScheduleSlotPayload[];
}): Promise<{ ok: boolean; created_count: number; owner_key: string; week_phase: WeekPhase }> {
  return httpJson(`${apiBaseUrl()}/v1/admin/staff-schedule/bulk/`, {
    method: 'POST',
    headers: await authHeaders(),
    body,
    timeoutMs: 60000,
  });
}

export { HttpError };

export async function listAdminStaffPings(
  ownerKey?: string,
  options?: { mode?: 'live' | 'history' },
): Promise<StaffLocationPingDto[]> {
  const params = new URLSearchParams();
  if (ownerKey?.trim()) params.set('owner_key', ownerKey.trim());
  if (options?.mode === 'live') params.set('mode', 'live');
  const q = params.toString() ? `?${params.toString()}` : '';
  const data = await httpJson<StaffLocationPingDto[] | PagedResponse<StaffLocationPingDto>>(
    `${apiBaseUrl()}/v1/admin/staff-location-pings/${q}`,
    {
      headers: await authHeaders(),
      timeoutMs: 30000,
    },
  );
  return unwrapPagedResults(data);
}

export async function listAdminStaffAlerts(ownerKey?: string): Promise<StaffLocationAlertDto[]> {
  const q = ownerKey?.trim() ? `?owner_key=${encodeURIComponent(ownerKey.trim())}` : '';
  const data = await httpJson<StaffLocationAlertDto[] | PagedResponse<StaffLocationAlertDto>>(
    `${apiBaseUrl()}/v1/admin/staff-location-alerts/${q}`,
    {
      headers: await authHeaders(),
      timeoutMs: 30000,
    },
  );
  return unwrapPagedResults(data);
}

/** "Katta ekran" jonli monitoring — hozir kim darsda, kim yo'q. */
export type LiveTeachingRow = {
  owner_key: string;
  display_name: string;
  department: string;
  building_name: string;
  slot_start: string;
  slot_end: string;
  title: string;
  present: boolean;
  ping_age_min: number | null;
};

export type LiveTeachingStatusDto = {
  jami: number;
  joyida: number;
  joyida_emas: number;
  royxat: LiveTeachingRow[];
};

export async function fetchLiveTeachingStatus(): Promise<LiveTeachingStatusDto> {
  return httpJson(`${apiBaseUrl()}/v1/admin/live-teaching-status/`, {
    headers: await authHeaders(),
    timeoutMs: 15000,
  });
}

export type DepartmentSubjectDto = {
  id: number;
  subject_name: string;
  subject_code: string;
  is_active: boolean;
  report_excluded: boolean;
};

export type AdminDepartmentDto = {
  id: number;
  name: string;
  code: string;
  hemis_name: string;
  is_active: boolean;
  report_excluded: boolean;
  teacher_count: number;
  subjects: DepartmentSubjectDto[];
};

export async function listAdminDepartments(): Promise<{
  results: AdminDepartmentDto[];
  unassigned_subjects: DepartmentSubjectDto[];
}> {
  return httpJson(`${apiBaseUrl()}/v1/admin/departments/`, {
    headers: await authHeaders(),
    timeoutMs: 20000,
  });
}

/** Kafedrani rektor hisobotiga qo'shadi yoki undan chiqaradi. */
export async function setDepartmentReportExcluded(id: number, excluded: boolean): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/admin/departments/${id}/`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: { report_excluded: excluded },
    timeoutMs: 20000,
  });
}

/** Fanni rektor hisobotiga qo'shadi yoki undan chiqaradi. */
export async function setSubjectReportExcluded(id: number, excluded: boolean): Promise<void> {
  await httpJson(`${apiBaseUrl()}/v1/admin/departments/subjects/${id}/`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: { report_excluded: excluded },
    timeoutMs: 20000,
  });
}
