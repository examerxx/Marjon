import { api } from "./client";

export const paymentsService = Object.freeze({
  listByOrder(orderId, config = {}) {
    return api.get(`/payments/order/${orderId}`, config);
  },
});
