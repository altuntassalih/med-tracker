# Med-Tracker 💊

Med-Tracker is a premium, AI-powered medication management application designed to simplify your health routine. Track medications for yourself and your family with a state-of-the-art, dark-mode-optimized user experience.

[Türkçe açıklama için aşağıya kaydırın / Scroll down for Turkish description]

---

## 🌟 Key Features (English)

-   **🤖 AI-Powered Suggestions**: Search and discover medication names instantly using Google Gemini AI.
-   **🌍 Crowdsourced Global Cache**: Every medication found via AI is saved to a global Firestore database, shared in real-time with all users worldwide.
-   **👤 Multi-Profile Support**: Manage up to 5 different profiles (family members, pets, etc.) with personalized avatars and medication plans.
-   **🔄 Real-Time Synchronization**: All updates are synced instantly across your devices and with the global database.
-   **🌙 Premium Dark UI**: A sleek, modern, and eye-friendly dark mode interface.
-   **⏰ Smart Reminders**: Never miss a dose with local push notifications and detailed medication logs.

### 🛠 Tech Stack
-   **Frontend**: React Native / Expo (Router) / TypeScript
-   **State Management**: Zustand (with Persistence)
-   **Backend**: Firebase Firestore (Real-time Database) & Authentication
-   **AI Intelligence**: Google Gemini API

---

## 🌟 Öne Çıkan Özellikler (Türkçe)

-   **🤖 Yapay Zeka Destekli Öneriler**: Google Gemini AI kullanarak ilaç isimlerini anında arayın ve keşfedin.
-   **🌍 Küresel Bulut Arşivi**: Yapay zeka ile bulunan her ilaç ismi global bir Firestore veritabanına kaydedilir ve tüm dünyadaki kullanıcılarla gerçek zamanlı olarak paylaşılır.
-   **👤 Çoklu Profil Desteği**: Aile üyeleri, evcil hayvanlar vb. için 5 farklı profile kadar (özel avatarlarla) yönetim sağlayın.
-   **🔄 Gerçek Zamanlı Senkronizasyon**: Tüm güncellemeler cihazlarınız arasında ve küresel veritabanıyla anlık olarak eşitlenir.
-   **🌙 Premium Karanlık Arayüz**: Şık, modern ve göz yormayan karanlık mod tasarımı.
-   **⏰ Akıllı Hatırlatıcılar**: Yerel bildirimler ve detaylı ilaç günlükleri sayesinde hiçbir dozu kaçırmayın.

### 🛠 Teknoloji Yığını
-   **Frontend**: React Native / Expo (Router) / TypeScript
-   **Durum Yönetimi**: Zustand (Kalıcı Hafıza ile)
-   **Backend**: Firebase Firestore (Canlı Veritabanı) & Kimlik Doğrulama
-   **Yapay Zeka**: Google Gemini API

---

## 🚀 Getting Started / Başlangıç

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/altuntassalih/med-tracker.git
    cd med-tracker
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Environment Variables**:
    Create a `.env` file and add your Gemini API Key:
    ```env
    EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
    ```

4.  **Run the App**:
    ```bash
    npx expo start
    ```

---

## 📦 Current Version
**v1.0.2** - Optimized for performance and cross-user real-time sync.

**Author**: [altuntassalih](https://github.com/altuntassalih)
