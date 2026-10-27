import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import logo from "../assets/marjon-logo.svg";
import Icon from "../components/Icon";
import { readStoredProfile, updateStoredProfile } from "../utils/profileCache";
import { t } from "../i18n/t";

export default function ProfileSettingsPage() {
  const { user } = useOutletContext();
  const storedProfile = useMemo(() => readStoredProfile(user?.id), [user?.id]);
  const defaultName = user?.full_name || user?.email || "manager@marjon.uz";
  const [name, setName] = useState(defaultName);
  const [photo, setPhoto] = useState(storedProfile.photo || "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setName(defaultName);
    setPhoto(storedProfile.photo || "");
    setMessage("");
  }, [defaultName, storedProfile.photo, user?.id]);

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage(t("pages.profilesettingspage.select_image_file"));
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
      setMessage(t("pages.profilesettingspage.enter_profile_name"));
      return;
    }

    updateStoredProfile(user?.id, { name: trimmedName, photo });
    setName(trimmedName);
    setMessage(t("pages.profilesettingspage.settings_saved_local"));
  }

  function removePhoto() {
    setPhoto("");
    setMessage(t("pages.profilesettingspage.photo_will_reset"));
  }

  return (
    <section className="profile-settings-page">
      <div className="profile-settings-card">
        <div className="profile-settings-card__preview">
          <div className="profile-settings-card__avatar">
            <img src={photo || logo} alt={name || "MARJON"} />
          </div>
          <div>
            <span>{t("pages.profilesettingspage.profil")}</span>
            <strong>{name || defaultName}</strong>
            <small>{user?.company_name || "MARJON"}</small>
          </div>
        </div>

        <form className="profile-settings-form" onSubmit={handleSubmit}>
          <label>
           {t("pages.profilesettingspage.imya")}
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("pages.profilesettingspage.vvedite_imya")} />
          </label>

          <label className="profile-settings-form__upload">
           {t("pages.profilesettingspage.foto_profilya")}
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
            <span><Icon name="bi-image" size={18} /> {t("pages.profilesettingspage.vybrat_foto")}</span>
          </label>

          <div className="profile-settings-form__actions">
            <button type="submit"><Icon name="bi-check2" size={18} /> {t("pages.profilesettingspage.sohranit")}</button>
            <button type="button" onClick={removePhoto}><Icon name="bi-trash3" size={18} /> {t("pages.profilesettingspage.ubrat_foto")}</button>
          </div>

          {message ? <p className="profile-settings-form__message">{message}</p> : null}
        </form>
      </div>
    </section>
  );
}
