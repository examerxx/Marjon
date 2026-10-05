import { api } from "./client";

export const catalogService = Object.freeze({
  listProducts(config) {
    return config ? api.get("/inventory/products", config) : api.get("/inventory/products");
  },
  createProduct(payload) {
    return api.post("/inventory/products", payload);
  },
  updateProduct(id, payload) {
    return api.patch(`/inventory/products/${id}`, payload);
  },
  deleteProduct(id) {
    return api.delete(`/inventory/products/${id}`);
  },
  // Фото блюда: multipart FormData {file}; jpg/png/webp (backend truth).
  // Возвращает полный ProductResponse с сохранённым image_url.
  uploadProductPhoto(id, file) {
    const body = new FormData();
    body.append("file", file);
    return api.post(`/inventory/products/${id}/photo`, body);
  },
  listCategories(config) {
    return config ? api.get("/inventory/categories", config) : api.get("/inventory/categories");
  },
  createCategory(payload) {
    return api.post("/inventory/categories", payload);
  },
  updateCategory(categoryId, payload) {
    return api.patch(`/inventory/categories/${categoryId}`, payload);
  },
  deleteCategory(categoryId) {
    return api.delete(`/inventory/categories/${categoryId}`);
  },
  // Добавки (модификаторы) блюда: группа принадлежит блюду, внутри — опции с наценкой.
  listModifierGroups(productId, config) {
    const url = `/inventory/products/${productId}/modifier-groups`;
    return config ? api.get(url, config) : api.get(url);
  },
  createModifierGroup(payload) {
    return api.post("/inventory/modifier-groups", payload);
  },
  updateModifierGroup(groupId, payload) {
    return api.patch(`/inventory/modifier-groups/${groupId}`, payload);
  },
  deleteModifierGroup(groupId) {
    return api.delete(`/inventory/modifier-groups/${groupId}`);
  },
});
