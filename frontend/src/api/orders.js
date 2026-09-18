import { api } from "./client";

export const ordersService = Object.freeze({
  list(params, config = {}) {
    return params
      ? api.get("/pos/orders", { params, ...config })
      : Object.keys(config).length ? api.get("/pos/orders", config) : api.get("/pos/orders");
  },
  get(orderId, config = {}) {
    return api.get(`/pos/orders/${orderId}`, config);
  },
});
