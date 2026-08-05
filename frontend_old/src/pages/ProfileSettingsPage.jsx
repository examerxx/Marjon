import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import logo from "../assets/marjon-logo.svg";
import Icon from "../components/Icon";

const PROFILE_STORAGE_KEY = "marjon_profile_settings";

function readStoredProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function ProfileSettingsPage() {
  const { user } = useOutletContext();
  const storedProfile = useMemo(() => readStoredProfile(), []);
  const defaultName = user?.full_name || user?.email || "manager@marjon.uz";
  const [name, setName] = useState(storedProfile.name || defaultName);
  const [photo, setPhoto] = useState(storedProfile.photo || "");
  const [message, setMessage] = useState("");

  function updateStoredProfile(nextProfile) {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    window.dispatchEvent(new CustomEvent("marjon-profile-updated", { detail: nextProfile }));
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Выберите файл изображения.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhoto(String(reader.result || ""));
      setMessage("");
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setMessage("Введите имя профиля.");
      return;
    }

    updateStoredProfile({ name: trimmedName, photo });
    setName(trimmedName);
    setMessage("Профиль обновлен.");
  }

  function removePhoto() {
    setPhoto("");
    setMessage("Фото будет сброшено после сохранения.");
  }

  return (
    <section className="profile-settings-page">
      <div className="profile-settings-card">
        <div className="profile-settings-card__preview">
          <div className="profile-settings-card__avatar">
            <img src={photo || logo} alt={name || "MARJON"} />
          </div>
          <div>
            <span>Профиль</span>
            <strong>{name || defaultName}</strong>
            <small>{user?.company_name || "MARJON"}</small>
          </div>
        </div>

        <form className="profile-settings-form" onSubmit={handleSubmit}>
          <label>
            Имя
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Введите имя" />
          </label>

          <label className="profile-settings-form__upload">
            Фото профиля
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
            <span><Icon name="bi-image" size={18} /> Выбрать фото</span>
          </label>

          <div className="profile-settings-form__actions">
            <button type="submit"><Icon name="bi-check2" size={18} /> Сохранить</button>
            <button type="button" onClick={removePhoto}><Icon name="bi-trash3" size={18} /> Убрать фото</button>
          </div>

          {message ? <p className="profile-settings-form__message">{message}</p> : null}
        </form>
      </div>
    </section>
  );
}
