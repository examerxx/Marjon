import { api } from "./client";

// In-app уведомления админки. Сейчас их создаёт сервер на события, которые
// владелец не должен пропустить (досинхронизированный офлайн-заказ); колокольчик
// опрашивает непрочитанные вместе с отменами и дефицитом.
export const notificationsService = {
  unread(config = {}) {
    return api.get("/notifications/unread", config);
  },
  markRead(id, config = {}) {
    return api.patch(`/notifications/${id}/read`, null, config);
  },
};
