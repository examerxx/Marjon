import { api } from "./client";

const RESOURCE_PATHS = Object.freeze({
  clients: "/crm/counterparties",
  places: "/halls",
  paymentMethods: "/finance/payment-types",
  units: "/units",
  printers: "/printers",
});

function resourcePath(resource) {
  const path = RESOURCE_PATHS[resource];
  if (!path) throw new TypeError(`Unknown settings resource: ${resource}`);
  return path;
}

export const settingsService = Object.freeze({
  listResource(resource, config) {
    return config ? api.get(resourcePath(resource), config) : api.get(resourcePath(resource));
  },
  createResource(resource, payload) {
    return api.post(resourcePath(resource), payload);
  },
  updateResource(resource, id, payload) {
    return api.patch(`${resourcePath(resource)}/${id}`, payload);
  },
  deleteResource(resource, id) {
    return api.delete(`${resourcePath(resource)}/${id}`);
  },
  getCompanyProfile(config) {
    return config ? api.get("/companies/me", config) : api.get("/companies/me");
  },
  updateCompanyProfile(payload) {
    return api.patch("/companies/me", payload);
  },
  listBranches(config) {
    return config ? api.get("/companies/me/branches", config) : api.get("/companies/me/branches");
  },
  // Canonical Место (Hall) + Столы (Table) management. Halls are returned with
  // their active nested tables, so the Places page needs one authoritative list
  // request (no per-hall N+1). Deactivate maps to the backend soft-delete.
  listPlaces(config) {
    return config ? api.get("/halls", config) : api.get("/halls");
  },
  createPlace(payload) {
    return api.post("/halls", payload);
  },
  updatePlace(id, payload) {
    return api.patch(`/halls/${id}`, payload);
  },
  deactivatePlace(id) {
    return api.delete(`/halls/${id}`);
  },
  // Phase 5C-6B: persist a COMPLETE branch-scoped hall order in ONE request.
  // payload = { branch_id, hall_ids } — hall_ids MUST be the full ordered set
  // of that branch's halls (active + inactive). Backend PATCH /halls/reorder is
  // atomic and branch-scoped; the body is passed through unchanged (no per-hall
  // requests, no transformation).
  reorderPlaces(payload, config) {
    return config
      ? api.patch("/halls/reorder", payload, config)
      : api.patch("/halls/reorder", payload);
  },
  listPlaceTables(hallId, config) {
    return config ? api.get(`/halls/${hallId}/tables`, config) : api.get(`/halls/${hallId}/tables`);
  },
  createPlaceTable(hallId, payload) {
    return api.post(`/halls/${hallId}/tables`, payload);
  },
  updatePlaceTable(hallId, tableId, payload) {
    return api.patch(`/halls/${hallId}/tables/${tableId}`, payload);
  },
  deactivatePlaceTable(hallId, tableId) {
    return api.delete(`/halls/${hallId}/tables/${tableId}`);
  },
  listDashboardPlaces(config) {
    return config ? api.get("/settings/places", config) : api.get("/settings/places");
  },
  getBillingBalance() {
    return api.get("/billing/balance");
  },
  createSupportTicket(payload) {
    return api.post("/support/tickets", payload);
  },
});

export { RESOURCE_PATHS };
