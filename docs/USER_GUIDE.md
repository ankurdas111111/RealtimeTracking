# Kinnect - User Journey & Product Usage Guide

> **Kinnect** = *Kin + Connect* — Your family, always close.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [What You Can Do With Kinnect](#3-what-you-can-do-with-kinnect)
4. [Getting Started Journey](#4-getting-started-journey)
5. [Core User Flows](#5-core-user-flows)
   - 5.1 [Register & First Login](#51-register--first-login)
   - 5.2 [Start & Stop GPS Tracking](#52-start--stop-gps-tracking)
   - 5.3 [Add a Contact](#53-add-a-contact)
   - 5.4 [Create or Join a Room](#54-create-or-join-a-room)
   - 5.5 [Generate & Share a Live Link](#55-generate--share-a-live-link)
   - 5.6 [Trigger an SOS Emergency](#56-trigger-an-sos-emergency)
   - 5.7 [View Someone's Live Link](#57-view-someones-live-link)
   - 5.8 [View an SOS Watch Link](#58-view-an-sos-watch-link)
   - 5.9 [Measure Distance Between Two Points](#59-measure-distance-between-two-points)
6. [Advanced Flows](#6-advanced-flows)
   - 6.1 [Admin: Configure Auto-SOS](#61-admin-configure-auto-sos)
   - 6.2 [Admin: Set a Geofence](#62-admin-set-a-geofence)
   - 6.3 [Admin: Configure Check-In](#63-admin-configure-check-in)
   - 6.4 [Admin: Promote or Demote Users](#64-admin-promote-or-demote-users)
   - 6.5 [Admin: Delete a User](#65-admin-delete-a-user)
   - 6.6 [Offline Retention & Location Persistence](#66-offline-retention--location-persistence)
7. [Visibility Rules — Who Sees Whom](#7-visibility-rules--who-sees-whom)
8. [Error & Edge Case Scenarios](#8-error--edge-case-scenarios)
9. [Benefits & Value to the User](#9-benefits--value-to-the-user)
10. [FAQs / Common Scenarios](#10-faqs--common-scenarios)

---

## 1. Product Overview

**Kinnect** is a real-time location-sharing and safety application designed for families, friend groups, and small teams. It lets you see where your loved ones are on a live map, share your own location, and send emergency SOS alerts — all from a web browser with no app install required.

### What problems does Kinnect solve?

| Problem | How Kinnect Helps |
|---|---|
| "Is my family member safe?" | See their live location on a map in real time. |
| "I need help right now." | One-tap SOS sends your location to everyone who matters. |
| "I want to share my location temporarily." | Generate a time-limited live link (1h, 6h, 24h) anyone can open. |
| "We're at an event and need to find each other." | Create a Room — everyone in the room sees each other. |
| "My elderly parent hasn't moved in hours." | Auto-SOS triggers an alert when no movement is detected. |
| "I want to make sure my child checks in periodically." | Check-in system reminds them and alerts you if they miss one. |

### Core Principles

- **Privacy first** — You control exactly who sees your location and for how long.
- **No app install** — Works in any modern web browser on phone, tablet, or desktop.
- **Real-time** — Positions update live, not on a delay.
- **Simple sharing** — Share codes, room codes, and live links make connecting effortless.

---

## 2. User Roles & Permissions

Kinnect has two roles: **Member** (regular user) and **Admin**.

### Member (Regular User)

Every new account starts as a Member. Members can:

- Track and share their own GPS location
- Add contacts and join rooms
- See contacts and room members on the live map
- Generate temporary live sharing links
- Trigger and cancel SOS emergencies
- Acknowledge other users' SOS alerts
- Set their offline retention preference (24h or 48h)
- Switch between light and dark theme
- Measure distance between two points on the map

### Admin

An Admin has all Member capabilities, plus:

- See **all** users regardless of contact/room relationships
- Configure **Auto-SOS** rules for any user (no-movement detection, hard-stop detection)
- Set **Geofences** for any user (alert when they leave an area)
- Configure **Check-In** schedules for any user (periodic "I'm OK" prompts)
- **Promote** other users to Admin or **demote** them back to Member
- **Delete** any user from the system
- Mark any user's location to be kept **forever** (no offline expiry)
- View database health statistics

**How is the first Admin created?**
During deployment, the server administrator sets an `ADMIN_EMAIL` environment variable. The first user who registers with that email address is automatically promoted to Admin. After that, any Admin can promote other users.

---

## 3. What You Can Do With Kinnect

### Feature Catalog

| Feature | What It Does | Who Can Use It |
|---|---|---|
| **Real-Time GPS Tracking** | Shows your live position on the map as you move. | All users |
| **Contact Sharing** | Add someone as a contact so they can see your location. | All users |
| **Room Sharing** | Create or join a group room — all members see each other. | All users |
| **Live Links** | Generate a public URL that shows your location for 1h, 6h, 24h, or until you stop it. Anyone with the link can view. | All users |
| **SOS Emergency** | One-tap emergency button sends your location to all your contacts and generates a shareable watch link. | All users |
| **SOS Watch Link** | A special link created during SOS that anyone can open to see the emergency location. | Anyone with the link |
| **Auto-SOS** | Automatically triggers SOS if a user hasn't moved for a configurable time, or makes a sudden hard stop. | Admin configures for users |
| **Geofence** | Defines a safe zone; triggers an alert if the user leaves the area. | Admin configures for users |
| **Check-In System** | Periodically asks a user to confirm they're OK. Alerts Admin if they miss a check-in. | Admin configures for users |
| **Distance Measurement** | Select any two points (users or map clicks) to see the straight-line distance between them. | All users |
| **Dark / Light Theme** | Toggle between light and dark map themes. | All users |
| **Offline Persistence** | After you disconnect, your last-known location stays visible to your contacts for 24h (or 48h if you choose). | All users |
| **Location Persistence** | Your last-known position is saved to the database and survives server restarts. | Automatic |

---

## 4. Getting Started Journey

Here is the quickest path from "I've never used Kinnect" to "I'm sharing my location with my family."

1. **Open Kinnect** in your browser (e.g., `https://your-kinnect-domain.com`).
2. **Create an account** — provide your name, email or mobile, and a password.
3. **Log in** — you're taken to the main map screen.
4. **Enable alerts** — a one-time prompt asks you to allow sound and vibration for emergencies. Tap "Enable Alerts."
5. **Start tracking** — tap the blue **Track** button at the bottom right. Allow GPS permission when your browser asks.
6. **Share your code** — open the **Sharing** panel and copy your 6-character Share Code. Send it to a family member.
7. **Add a contact** — when your family member gives you their share code (or email/mobile), enter it in the Sharing panel to add them.
8. **See each other** — once you've added each other, you'll both appear on each other's maps.

```
@startuml
!theme cerulean

title Getting Started with Kinnect

skinparam responseMessageBelowArrow true
skinparam sequenceMessageAlign center

actor "New User" as User
box "Your Device" #F0F8FF
  participant "Browser" as Browser
  participant "Kinnect App" as App
end box
participant "Kinnect Server" as Server

autonumber "<b>[0]"

== Step 1 — Sign Up ==

User -> Browser: Open Kinnect URL
Browser -> App: Load login page
User -> App: Tap "Create one"
App -> Browser: Show registration form
User -> App: Enter name, email/mobile, password
App -> Server: Submit registration
Server -> Server: Validate, hash password,\ngenerate Share Code
Server -> App: Account created — redirect to map

== Step 2 — Enable Alerts ==

App -> User: Show "Enable Alerts" prompt
User -> App: Tap "Enable Alerts"
note right of User: Enables sound & vibration\nfor emergencies

== Step 3 — Start Tracking ==

User -> App: Tap the blue Track button
Browser -> Browser: Request GPS permission
note left of Browser: One-time browser prompt
Browser -> App: GPS position stream begins
App -> Server: Send live position updates
App -> User: Your blue marker appears on the map!

legend right
  You are now live on the map.
  Share your code with family
  to start seeing each other.
end legend
@enduml
```

---

## 5. Core User Flows

### 5.1 Register & First Login

#### Registration

**What you need:** A first name, an email address or mobile number, and a password (minimum 6 characters).

**Step by step:**

1. Open the Kinnect URL in your browser.
2. On the login page, click **"Create one"** at the bottom.
3. The registration form appears with fields for:
   - **First Name** (required)
   - **Last Name** (optional)
   - **Password** and **Confirm Password** (minimum 6 characters)
   - **Contact method toggle** — choose **Email** or **Mobile**
   - If Email: enter your email address
   - If Mobile: select your country code from the dropdown, then enter your local mobile number
4. Click **"Create account"**.
5. If everything is valid, you are automatically logged in and taken to the main map.

**What you gain:** A unique 6-character **Share Code** is generated for your account. This is your personal identifier that others can use to add you as a contact.

```
@startuml
!theme cerulean

title Registration Flow

skinparam responseMessageBelowArrow true

actor "You" as User
box "Kinnect Website" #F0F8FF
  participant "Registration\nPage" as RegPage
end box
box "Backend" #FFFFF0
  participant "Server" as Server
  database "Database" as DB
end box

autonumber "<b>[0]"

User -> RegPage: Fill in name, password, email or mobile
User -> RegPage: Tap "Create account"
RegPage -> Server: Submit registration form
Server -> Server: Validate all fields

alt #FFE0E0 Something is wrong
    Server -> RegPage: Return error
    RegPage -> User: Show message\n(e.g. "Passwords do not match")
else #E0FFE0 Everything looks good
    Server -> Server: Securely hash password
    Server -> Server: Generate your unique\n6-character Share Code
    Server -> DB: Save new account
    DB --> Server: Confirm (user ID created)
    Server -> Server: Start your login session
    Server -> RegPage: Redirect to main app
    RegPage -> User: Welcome! The map loads.
    note right of User
      Your Share Code is ready.
      Find it in the Sharing panel.
    end note
end
@enduml
```

#### Login

**Step by step:**

1. Open the Kinnect URL. The login page appears.
2. Choose your login method: **Email** or **Mobile** (toggle at the top of the form).
3. Enter your email address or your country code + mobile number.
4. Enter your password.
5. Click **"Sign in"**.
6. You are taken to the main map.

**Session duration:** Your login session lasts 7 days. You won't need to log in again during that time unless you explicitly log out.

```
@startuml
!theme cerulean

title Login Flow

skinparam responseMessageBelowArrow true

actor "You" as User
box "Kinnect Website" #F0F8FF
  participant "Login Page" as LoginPage
end box
participant "Server" as Server

autonumber "<b>[0]"

User -> LoginPage: Choose Email or Mobile
User -> LoginPage: Enter credentials
User -> LoginPage: Tap "Sign in"
LoginPage -> Server: Submit login

Server -> Server: Look up account

alt #FFE0E0 Not found or wrong password
    Server -> LoginPage: "Invalid credentials"
    LoginPage -> User: Show error message
else #E0FFE0 Credentials match
    Server -> Server: Create session\n(stays logged in for 7 days)
    Server -> LoginPage: Redirect to main app
    LoginPage -> User: Map loads — you are in!
end
@enduml
```

---

### 5.2 Start & Stop GPS Tracking

**What it does:** Sends your live GPS position to Kinnect so your contacts and room members can see where you are on the map.

**Step by step — Start Tracking:**

1. On the main map screen, look at the bottom-right corner for the blue **Track** button (map pin icon).
2. Tap it. Your browser will ask for GPS permission the first time — tap **Allow**.
3. Your position appears as a **blue marker** on the map.
4. As you move, a **blue path line** traces your route.
5. Your latitude, longitude, speed, and last-update time appear in the **Info** panel.
6. Your contacts and room members now see your marker on their maps.

**Step by step — Stop Tracking:**

1. The Track button now shows a **stop icon** with a red tint.
2. Tap it again to stop tracking.
3. Your position stops updating, but your last-known location remains visible to contacts.

**Step by step — Reset:**

1. Tap the smaller **Reset** button (refresh icon) below the Track button.
2. This clears your path line, removes your marker, and resets the map view.

```
@startuml
!theme cerulean

title Real-Time GPS Tracking

skinparam responseMessageBelowArrow true

actor "You" as User
box "Your Device" #F0F8FF
  participant "GPS Sensor" as GPS
  participant "Kinnect App" as App
end box
box "Backend" #FFFFF0
  participant "Server" as Server
end box
actor "Your Contacts" as Others

autonumber "<b>[0]"

== Start Tracking ==

User -> App: Tap Track button
App -> GPS: Start GPS stream
GPS -> App: Position (lat, lng, speed)
App -> App: Show your blue marker\n+ draw path on map
App -> App: Update Info panel\n(lat, lng, speed, time)
App -> Server: Send position update
Server -> Server: Store in memory
Server -> Server: Save to database\n(every 30 seconds)
Server -> Others: Broadcast your\nupdated position
Others -> Others: Your marker moves\non their map

|||

== Stop Tracking ==

User -> App: Tap Track button again
App -> GPS: Stop GPS stream
note right of App
  Your last-known position
  stays visible to contacts.
end note
@enduml
```

---

### 5.3 Add a Contact

**What it does:** Adding someone as a contact shares your location with them. They will see your position on their map and in their users list.

**Important:** When you add someone, **they see you**. For **you** to see **them**, they must also add you. This is a two-way safety design.

There are three ways to add a contact:

#### Method A: By Share Code

1. Ask your family member for their 6-character Share Code (e.g., `A3K9BT`). They can find it in their **Sharing** panel.
2. Open the **Sharing** panel (tap the share icon in the navbar).
3. Scroll to the **Contacts** section.
4. Enter the share code in the **"Add by share code"** field.
5. Tap **Add**.
6. A confirmation appears: "Contact added."

#### Method B: By Email

1. Open the **Sharing** panel.
2. In the Contacts section, enter the person's registered email in the **"Add by email or mobile"** field.
3. Tap **Add**.
4. If the email is found in Kinnect, the contact is added.

#### Method C: By Mobile Number

1. Same as Method B, but enter their full mobile number with country code (e.g., `+919876543210`).

**What happens after you add a contact:**
- The person you added immediately sees your location on their map (if you are tracking).
- They appear in your contact list in the Sharing panel.
- You will NOT see their location until they also add you back.

**Removing a contact:**
- In the Sharing panel, find the contact and tap **Remove**.
- They will immediately stop seeing your location.

```
@startuml
!theme cerulean

title Adding a Contact — Who Sees Whom

skinparam responseMessageBelowArrow true

actor "User A\n(You)" as A
participant "Kinnect Server" as Server
actor "User B\n(Family)" as B

autonumber "<b>[0]"

== You add B as a contact ==

A -> Server: Add contact\n(B's share code)
Server -> Server: Validate code\nCheck limit (max 50)
Server -> Server: Save: A added B
Server -> A: "Contact added!"
Server -> Server: Refresh B's visibility
Server -> B: Update: B can now\nsee A on the map

note right of B #E0FFE0
  B can see A's location.
  A cannot yet see B.
end note

|||

== For mutual visibility — B adds A back ==

B -> Server: Add contact\n(A's share code)
Server -> Server: Save: B added A
Server -> B: "Contact added!"
Server -> Server: Refresh A's visibility
Server -> A: Update: A can now\nsee B on the map

note over A, B #E0FFE0
  Both can now see each other!
  Mutual visibility achieved.
end note
@enduml
```

---

### 5.4 Create or Join a Room

**What it does:** A Room is a group space where all members can see each other's locations. Unlike contacts (which are one-to-one), a room lets an entire group share simultaneously.

#### Create a Room

1. Open the **Sharing** panel.
2. In the **Rooms** section, enter a room name (e.g., "Family Trip").
3. Tap **Create**.
4. A new room appears with a 6-character Room Code (e.g., `K7M2PQ`).
5. Share this code with the people you want to join.

#### Join a Room

1. Get the 6-character Room Code from the room creator.
2. Open the **Sharing** panel.
3. Enter the code in the **"Join room"** field.
4. Tap **Join**.
5. You are now a member. All other room members appear on your map and vice versa.

#### Leave a Room

1. In the Sharing panel, find the room in your room list.
2. Tap **Leave**.
3. You stop seeing room members (unless they're also your contacts).
4. If you were the last member, the room is automatically deleted.

**Limits:** You can be in up to 20 rooms simultaneously.

```
@startuml
!theme cerulean

title Creating & Joining a Room

skinparam responseMessageBelowArrow true

actor "Creator" as Creator
participant "Kinnect Server" as Server
actor "Friend" as Joiner

autonumber "<b>[0]"

== Phase 1 — Create a Room ==

Creator -> Server: Create room\n("Family Trip")
Server -> Server: Generate unique 6-char code\nSave to database\nAdd Creator as first member
Server -> Creator: Room created!\nCode: K7M2PQ

note right of Creator
  Share this code with
  anyone you want to join.
end note

|||

== Phase 2 — Share the Code ==

Creator -> Joiner: "Join my room: K7M2PQ"\n(via text, email, etc.)

|||

== Phase 3 — Friend Joins ==

Joiner -> Server: Join room "K7M2PQ"
Server -> Server: Add to room members\nRefresh visibility
Server -> Joiner: Joined! See member list.
Server -> Creator: Visibility updated:\nnow sees Friend
Server -> Joiner: Visibility updated:\nnow sees Creator

note over Creator, Joiner #E0FFE0
  All room members see each other
  on the map automatically.
end note
@enduml
```

---

### 5.5 Generate & Share a Live Link

**What it does:** Creates a public URL that anyone can open in a browser to see your real-time location — no Kinnect account required. Perfect for sharing your location with a delivery driver, a friend picking you up, or anyone temporarily.

**Step by step:**

1. Open the **Sharing** panel.
2. Scroll to the **Live Sharing** section.
3. Tap the **"Generate Link"** button.
4. A dropdown appears with duration options:
   - **1 hour** — link expires after 1 hour
   - **6 hours** — link expires after 6 hours
   - **24 hours** — link expires after 24 hours
   - **Until I stop** — link stays active until you manually revoke it
5. Select a duration.
6. A link is generated and automatically copied to your clipboard.
7. A confirmation banner says "Live link created and copied!"
8. Paste the link into a message and send it to anyone.

**Managing your live links:**

- Active links appear in the Live Sharing section with their expiry time.
- Each link has a **Copy** button (to copy the URL again) and a **Revoke** button (to deactivate it immediately).
- You can have up to 10 active live links at a time.

**What the viewer sees:** See [Section 5.7](#57-view-someones-live-link).

```
@startuml
!theme cerulean

title Generate & Share a Live Link

skinparam responseMessageBelowArrow true

actor "You\n(Sharer)" as Sharer
box "Kinnect App" #F0F8FF
  participant "App" as App
end box
participant "Server" as Server
actor "Anyone\n(Viewer)" as Viewer

autonumber "<b>[0]"

== Phase 1 — Generate the Link ==

Sharer -> App: Tap "Generate Link"
App -> Sharer: Show duration options
Sharer -> App: Select "6 hours"
App -> Server: Create live link (6h)
Server -> Server: Generate secure token\nSave with 6h expiry
Server -> App: Link created!
App -> App: Copy URL to clipboard
App -> Sharer: "Live link created and copied!"

note right of Sharer: Paste and send to anyone

|||

== Phase 2 — Share the Link ==

Sharer -> Viewer: Send link via text,\nemail, or chat

|||

== Phase 3 — Viewer Opens Link ==

Viewer -> App: Open the live link URL
App -> Viewer: "Enter your name"
Viewer -> App: Type name, tap\n"Start Viewing"
App -> Server: Join live view
Server -> App: Current position + status
App -> Viewer: Map shows Sharer's\nlive location

|||

== Phase 4 — Real-Time Updates ==

loop As Sharer moves
  Server -> App: Position update
  App -> Viewer: Marker moves on map
end

|||

== Phase 5 — Link Expires ==

Server -> App: Link expired
App -> Viewer: "This link is no longer active."
@enduml
```

---

### 5.6 Trigger an SOS Emergency

**What it does:** Immediately alerts all your contacts and generates a shareable watch link. Use this when you are in danger or need help.

**Step by step — Trigger SOS:**

1. In the top navbar, find the red **SOS** button.
2. Tap it. The button text changes to **"Cancel SOS"** and begins pulsing.
3. What happens instantly:
   - All your contacts and room members are alerted with sound and visual notification.
   - A **Watch Link** is generated — a special URL that anyone can open to see your live location during the emergency.
   - The watch link is valid for 1 hour.
4. You can copy the watch link from the alert banner and send it to anyone (police, emergency services, a friend).

**Step by step — Cancel SOS:**

1. When the emergency is over, tap the pulsing **"Cancel SOS"** button.
2. All alerts are cleared. The watch link is deactivated.

**What your contacts experience:**

1. They hear an alarm sound and feel a vibration.
2. An alert overlay appears: "SOS Emergency — [Your Name] has triggered an emergency!"
3. Your marker on their map turns **red** and pulses.
4. They can tap **"Acknowledge"** to let you know they've seen the alert.
5. You can see how many people have acknowledged in your SOS banner.

```
@startuml
!theme cerulean

title SOS Emergency Flow

skinparam responseMessageBelowArrow true

actor "You\n(In Danger)" as User
box "Kinnect" #F0F8FF
  participant "App" as App
  participant "Server" as Server
end box
actor "Contact 1" as C1
actor "Contact 2" as C2
actor "Anyone\n(Watch Link)" as Viewer

autonumber "<b>[0]"

== Phase 1 — Trigger SOS ==

User -> App: Tap red SOS button
App -> Server: Trigger SOS
Server -> Server: Activate SOS state\nGenerate watch link (1h)
Server -> C1: SOS Alert!
Server -> C2: SOS Alert!

note right of C1 #FFE0E0
  Alarm sound + vibration
  Red alert overlay shown
  Your marker turns red
end note

C1 -> C1: Alarm + alert overlay
C2 -> C2: Alarm + alert overlay

|||

== Phase 2 — Share Watch Link ==

App -> User: Show SOS banner\nwith shareable watch link
User -> Viewer: Send watch link\n(text / call)
Viewer -> Server: Open watch link
Server -> Viewer: See live position\n+ SOS status

|||

== Phase 3 — Acknowledgements ==

C1 -> Server: Tap "Acknowledge"
Server -> User: "1 person acknowledged"

note right of User #E0FFE0: You know help is aware

|||

== Phase 4 — Cancel SOS ==

User -> App: Tap "Cancel SOS"
App -> Server: Cancel SOS
Server -> C1: SOS cleared
Server -> C2: SOS cleared
Server -> Viewer: Watch link deactivated
@enduml
```

---

### 5.7 View Someone's Live Link

**What it does:** Open a live link that someone shared with you to see their real-time position on a map — no account needed.

**Step by step:**

1. Receive a live link from someone (e.g., `https://kinnect.example.com/live/abc123xyz`).
2. Open it in any browser.
3. A card appears asking for your name — this is so the sharer knows who's viewing.
4. Enter your name and tap **"Start Viewing"**.
5. The map loads with the sharer's position shown as a marker.
6. The top status bar shows:
   - A green dot if they're online, gray if offline
   - "Tracking [Name]"
   - Check-in status (if configured by their admin)
7. The map updates in real time as the sharer moves.

**If the sharer triggers an SOS:**
- A red SOS banner appears at the top with the reason and timestamp.
- You hear an alarm and feel vibration.
- You can tap **"Acknowledge"** to let them know you've seen it.

**If the link expires:**
- The map is replaced with a card: "Link Expired — This live share link is no longer active."

```
@startuml
!theme cerulean

title Viewing a Live Link

skinparam responseMessageBelowArrow true

actor "You\n(Viewer)" as Viewer
box "Kinnect" #F0F8FF
  participant "Live Page" as LivePage
  participant "Server" as Server
end box

autonumber "<b>[0]"

Viewer -> LivePage: Open live link URL

alt #FFE0E0 Link expired or invalid
    LivePage -> Viewer: Show "Link Expired" card
    note right of Viewer: Ask the sharer\nfor a new link
else #E0FFE0 Link is valid
    LivePage -> Viewer: "Enter your name"
    Viewer -> LivePage: Type name "Mom"
    Viewer -> LivePage: Tap "Start Viewing"
    LivePage -> Server: Join live view as "Mom"
    Server -> LivePage: Current position + status
    LivePage -> Viewer: Map shows live location

    note right of Viewer
      Green dot = online
      Gray dot = offline
    end note

    |||

    loop Real-time updates
        Server -> LivePage: New position
        LivePage -> Viewer: Marker moves on map
    end

    |||

    alt #FFE0E0 SOS triggered
        Server -> LivePage: SOS alert!
        LivePage -> Viewer: Red banner + alarm sound
        Viewer -> LivePage: Tap "Acknowledge"
        LivePage -> Server: SOS acknowledged
    end

    |||

    alt #FFF0E0 Link expires
        Server -> LivePage: Link expired
        LivePage -> Viewer: "This link is\nno longer active."
    end
end
@enduml
```

---

### 5.8 View an SOS Watch Link

**What it does:** A minimal emergency view. When someone triggers an SOS, a special watch link is generated that shows only their location and SOS status. No account or name entry needed — designed for quick sharing with emergency responders.

**Step by step:**

1. Receive a watch link (e.g., `https://kinnect.example.com/watch/token456`).
2. Open it in any browser.
3. The map loads immediately — no name entry needed.
4. A banner at the top shows the SOS status:
   - Red: **"SOS: [reason] - Not yet acknowledged"** or **"Acknowledged (3)"**
   - Blue: **"Watch link is inactive"** (if SOS was cancelled)
5. A pulsing red marker shows the person's location.
6. The map follows their position as they move.

**Key difference from Live Links:** Watch links are specifically for SOS emergencies, last only 1 hour, and require no interaction to start viewing.

```
@startuml
!theme cerulean

title SOS Watch Link — Emergency View

skinparam responseMessageBelowArrow true

actor "Anyone\n(e.g. Responder)" as Responder
box "Kinnect" #F0F8FF
  participant "Watch Page" as WatchPage
  participant "Server" as Server
end box

autonumber "<b>[0]"

note over Responder
  No account needed.
  No name entry required.
  Just open the link.
end note

Responder -> WatchPage: Open watch link URL
WatchPage -> Server: Join SOS watch
Server -> WatchPage: Current position\n+ SOS state
WatchPage -> Responder: Map with pulsing red marker\nSOS banner shows reason

|||

loop Position updates
    Server -> WatchPage: Updated position
    WatchPage -> Responder: Marker follows the person
end

|||

alt #E0FFE0 SOS cancelled by user
    Server -> WatchPage: SOS cleared
    WatchPage -> Responder: Banner:\n"Watch link is inactive"
end
@enduml
```

---

### 5.9 Measure Distance Between Two Points

**What it does:** Lets you measure the straight-line distance between any two locations on the map — whether they are users or points you tap on the map.

**Step by step:**

1. Open the **Users** panel (tap the people icon in the navbar).
2. You see a list of all visible users with checkboxes.
3. Check the box next to one user (or yourself).
4. Check the box next to a second user.
5. A dashed orange line appears on the map between the two selected positions.
6. The distance (in meters) is shown at the midpoint of the line and at the top of the Users panel.
7. To clear, tap **"Clear"** in the distance display.

**Alternative — Using Map Clicks:**

1. Tap any point on the map to place a purple marker.
2. Tap a second point. A distance line appears between them.
3. You can also mix: select one user from the list and tap one point on the map.

```
@startuml
!theme cerulean

title Measuring Distance Between Two Points

skinparam responseMessageBelowArrow true

actor "You" as User
box "Kinnect App" #F0F8FF
  participant "Users Panel" as Panel
  participant "Map" as Map
end box

autonumber "<b>[0]"

== Select Two Points ==

User -> Panel: Check first user's box
Panel -> Map: Highlight first marker
User -> Panel: Check second user's box
Panel -> Map: Draw dashed orange line\nbetween the two positions

|||

== View Distance ==

Map -> Map: Calculate distance\n(Haversine formula)
Map -> User: Show distance at midpoint\n(e.g. "1,234 m")
Panel -> User: Distance shown in\npanel header

note right of User
  You can also tap two
  points on the map directly,
  or mix users + map taps.
end note

|||

== Clear Selection ==

User -> Panel: Tap "Clear"
Panel -> Map: Remove line and label
@enduml
```

---

## 6. Advanced Flows

### 6.1 Admin: Configure Auto-SOS

**What it does:** Automatically triggers an SOS if a tracked user:
- **Hasn't moved** for a configurable number of minutes (no-movement detection)
- **Made a sudden hard stop** — was moving fast (>25 km/h) and suddenly stopped (hard-stop detection)

**Step by step:**

1. Log in as an Admin.
2. Open the **Info** panel.
3. Scroll to **Admin Controls**.
4. In the **"Apply to"** dropdown, select the target user (or "Me").
5. Under **Auto-SOS**:
   - Toggle **Auto-SOS** to On.
   - Set **No-move (min):** e.g., 5 — triggers SOS if no movement for 5 minutes.
   - Set **Hard-stop (min):** e.g., 2 — triggers SOS if hard stop detected and no movement for 2 minutes.
6. Tap **"Apply Settings"**.
7. The rules are now active for that user. If conditions are met, SOS is triggered automatically.

```
@startuml
!theme cerulean

title Admin: Configure Auto-SOS

skinparam responseMessageBelowArrow true

actor "Admin" as Admin
box "Kinnect" #F0F8FF
  participant "Admin Panel" as Panel
  participant "Server" as Server
end box
actor "Tracked User" as Target

autonumber "<b>[0]"

== Setup ==

Admin -> Panel: Select target user
Admin -> Panel: Enable Auto-SOS\nNo-move: 5 min\nHard-stop: 2 min
Admin -> Panel: Tap "Apply Settings"
Panel -> Server: Save Auto-SOS rules
Server -> Server: Rules now active\nfor target

|||

== Monitoring (automatic) ==

loop Every position update
    Server -> Server: Has user moved\nin the last 5 minutes?

    alt #FFE0E0 No movement detected for 5+ min
        Server -> Server: Auto-trigger SOS!
        Server -> Admin: SOS Alert\n(auto-triggered)
        Server -> Target: SOS activated\non your behalf
        note right of Target #FFE0E0
          Contacts are alerted.
          Watch link is generated.
        end note
    end
end
@enduml
```

---

### 6.2 Admin: Set a Geofence

**What it does:** Defines a circular safe zone around a location. If the tracked user leaves this zone, an alert is triggered.

**Step by step:**

1. Open the **Info** panel as Admin.
2. In **Admin Controls**, select the target user.
3. Under **Geofence**:
   - Toggle **Geofence** to On.
   - Set **Radius (m):** e.g., 500 — defines a 500-meter radius around the user's current position.
4. Tap **"Apply Settings"**.
5. A purple circle appears on the map around the user's current position.
6. If the user moves outside the circle, a geofence breach SOS is triggered automatically.

**Note:** The geofence center is set to the user's position at the time the geofence is enabled. Only the Admin and the user themselves see geofence breach alerts.

```
@startuml
!theme cerulean

title Admin: Set a Geofence (Safe Zone)

skinparam responseMessageBelowArrow true

actor "Admin" as Admin
box "Kinnect" #F0F8FF
  participant "Admin Panel" as App
  participant "Server" as Server
end box
actor "Tracked User" as Target

autonumber "<b>[0]"

== Setup ==

Admin -> App: Enable geofence\nSet radius: 500 meters
App -> Server: Save geofence rules
Server -> Server: Safe zone created\naround user's current position

note right of Server
  A purple circle appears
  on the Admin's map.
end note

|||

== Monitoring (automatic) ==

loop Every position update from target
    Server -> Server: Is user inside\nthe safe zone?

    alt #FFE0E0 User exits the safe zone!
        Server -> Server: Trigger geofence SOS
        Server -> Admin: "User left the safe zone!"
        Server -> Target: Geofence alert
        note right of Target #FFF0E0
          Only Admin and the user
          see geofence alerts.
        end note
    end
end
@enduml
```

---

### 6.3 Admin: Configure Check-In

**What it does:** Periodically prompts a user to confirm they're OK by tapping an "I'm OK" button. If they miss the check-in, the Admin is alerted.

**Step by step (Admin setup):**

1. Open the **Info** panel as Admin.
2. In **Admin Controls**, select the target user.
3. Under **Check-In**:
   - Toggle **Check-In** to On.
   - Set **Interval (min):** e.g., 30 — asks the user every 30 minutes.
   - Set **Overdue (min):** e.g., 35 — alerts Admin if no response within 35 minutes.
4. Tap **"Apply Settings"**.

**What the tracked user experiences:**

1. Every 30 minutes, an alert overlay appears: "Check-In Required — Please confirm you're OK."
2. The user taps **"I'm OK"**.
3. The timer resets for the next 30 minutes.

**What happens if they miss it:**

1. If 35 minutes pass without a check-in, the Admin receives a "Check-in missed" alert with the user's name and last check-in time.
2. Live link viewers also see a "Check-in OVERDUE" indicator.

```
@startuml
!theme cerulean

title Admin: Configure Periodic Check-In

skinparam responseMessageBelowArrow true

actor "Admin" as Admin
participant "Server" as Server
actor "Tracked User" as Target

autonumber "<b>[0]"

== Setup ==

Admin -> Server: Enable check-in\nInterval: 30 min, Overdue: 35 min
Server -> Server: Rules saved and active

|||

== Normal Check-In Cycle ==

loop Server checks every 60 seconds
    Server -> Server: Time since last check-in?

    alt 30+ minutes since last check-in
        Server -> Target: "Please confirm you're OK"
        note right of Target #FFF0E0
          An overlay appears:
          "Check-In Required"
        end note

        alt #E0FFE0 User responds
            Target -> Server: Tap "I'm OK"
            Server -> Server: Timer reset.\nNext check-in in 30 min.
        else #FFE0E0 No response within 35 min
            Server -> Admin: "Check-in missed!"
            note right of Admin #FFE0E0
              Alert shows user name
              and last check-in time.
            end note
        end
    end
end
@enduml
```

---

### 6.4 Admin: Promote or Demote Users

**What it does:** Change a user's role between Member and Admin.

**Step by step:**

1. Go to the Admin page (`/admin`).
2. Select the user to promote or demote.
3. Choose the new role: **Admin** or **User (Member)**.
4. Confirm the change.
5. The user's role is updated immediately. If they're currently online, their permissions change in real time.

---

### 6.5 Admin: Delete a User

**What it does:** Permanently removes a user from the system. They are disconnected immediately and their marker disappears from all maps.

**Step by step:**

1. Open the **Users** panel.
2. Find the user you want to delete — an Admin sees a **Delete** button next to each user.
3. Tap **Delete**.
4. The user is immediately disconnected and removed from all maps.
5. Their data is cleared from the active session.

**Note:** This action is immediate and cannot be undone from the UI.

---

### 6.6 Offline Retention & Location Persistence

**What happens when you go offline (close the browser or lose connection):**

1. Your marker changes to **gray** on other people's maps, indicating you're offline.
2. Your last-known position remains visible for a retention period:
   - **Default:** 24 hours
   - **48 hours:** You can opt in by toggling "Keep location 48h" in the Info panel's Quick Actions.
   - **Forever:** An Admin can mark your location to be kept indefinitely.
3. After the retention period expires, your marker disappears from other users' maps.

**What happens after a server restart (e.g., redeployment):**

1. Your last-known position is saved to the database every 30 seconds while you're tracking.
2. When the server restarts, saved positions are loaded from the database.
3. When your contacts log back in, they immediately see your last-known position (shown as an offline marker) even before you reconnect.
4. Once you reconnect and start tracking, your marker updates to show your live position.

```
@startuml
!theme cerulean

title Offline Retention & Location Persistence

skinparam responseMessageBelowArrow true

actor "User A" as A
box "Kinnect" #F0F8FF
  participant "Server" as Server
  database "Database" as DB
end box
actor "User B\n(A's Contact)" as B

autonumber "<b>[0]"

== Normal Tracking ==

A -> Server: Position update\n(every few seconds)
Server -> Server: Update in-memory
Server -> DB: Save to database\n(every 30 seconds)

|||

== A Goes Offline ==

A ->x Server: Disconnect\n(closes browser)
Server -> B: "User A went offline"\n(last position, expires in 24h)
B -> B: A's marker turns gray

|||

== Server Restarts (e.g. redeployment) ==

Server -> DB: Load all saved positions
DB --> Server: Return last-known locations

|||

== B Reconnects ==

B -> Server: Connect to Kinnect
Server -> B: Here are your contacts\n(includes A's saved position)
B -> B: See A's gray marker\nat last-known location

note right of B #E0FFE0
  A's position is visible
  even before A reconnects!
end note

|||

== A Comes Back Online ==

A -> Server: Connect + start tracking
Server -> B: "User A is back online!"
B -> B: A's marker turns blue\nand shows live position
@enduml
```

---

## 7. Visibility Rules — Who Sees Whom

Kinnect uses a carefully designed visibility system to ensure privacy. Here's exactly who can see whom:

### Rule 1: Contacts — Directional Sharing

When **User A adds User B as a contact**, User B can see User A's location. User A does NOT automatically see User B.

For mutual visibility, **both must add each other**.

| Action | A sees B? | B sees A? |
|---|---|---|
| A adds B | No | Yes |
| B adds A | Yes | Yes (mutual) |
| A removes B | No | No |

### Rule 2: Rooms — Mutual Sharing

All members of a room see each other automatically. No need to add each other as contacts.

| Action | Result |
|---|---|
| A and B are in Room "Family" | A sees B, B sees A |
| A leaves the room | A no longer sees B (unless they're contacts) |

### Rule 3: Admins — See Everyone

Admins can see all users regardless of contacts or rooms. This is necessary for safety management.

### Rule 4: Self

You always see yourself.

### Summary Diagram

```
@startuml
!theme cerulean

title Who Can See Whom — Visibility Rules

left to right direction

skinparam actorStyle awesome
skinparam rectangle {
  RoundCorner 15
}

actor "User A" as A
actor "User B" as B
actor "User C" as C
actor "Admin" as Admin

rectangle "Room:\nFamily Trip" as Room #F0F8FF

A --> B : A adds B\n(B sees A)
B --> A : B adds A\n(A sees B)
note on link #E0FFE0 : Mutual\nvisibility

A --> Room : Member
C --> Room : Member
note bottom of Room : A and C see each other\nthrough room membership

Admin ..> A
Admin ..> B
Admin ..> C

legend right
  <b>Visibility Rules Summary</b>
  ----
  <b>Contacts:</b> You add B = B sees you
  <b>Rooms:</b> All members see each other
  <b>Admin:</b> Sees everyone always
  <b>Self:</b> You always see yourself
end legend
@enduml
```

---

## 8. Error & Edge Case Scenarios

### Authentication Errors

| What Happened | What You See | What To Do |
|---|---|---|
| Wrong email/mobile or password | "Invalid credentials" on the login page | Double-check your email/mobile and password. |
| Email already registered | "This email is already registered" on the register page | Use the login page instead, or use a different email. |
| Mobile already registered | "This mobile number is already registered" | Log in instead, or use a different number. |
| Passwords don't match (register) | "Passwords do not match" | Re-enter both password fields. |
| Password too short (register) | "Password must be at least 6 characters" | Use a longer password. |
| Too many login attempts | "Too many login attempts, try again in 15 minutes" | Wait 15 minutes and try again. |
| Too many registration attempts | "Too many registrations, try again later" | Wait 1 hour and try again. |

### Contact & Room Errors

| What Happened | What You See | What To Do |
|---|---|---|
| Invalid share code | "User not found with that share code" | Verify the code with the other person. Share codes are case-sensitive, 6 characters. |
| Email/mobile not found | "No user found with that email/mobile" | Confirm the person has a Kinnect account. |
| Adding yourself | "Cannot add yourself as a contact" | You don't need to add yourself. |
| Contact already added | "Already in your contacts" | No action needed — they're already your contact. |
| Contact limit reached | "Contact limit reached (50)" | Remove an existing contact first. |
| Room limit reached | "Room limit reached (20)" | Leave an existing room first. |
| Room not found | "Room not found" | Check the room code. |
| Already in room | "Already a member of this room" | You're already in — no action needed. |

### Live Link Errors

| What Happened | What You See | What To Do |
|---|---|---|
| Link expired | "Link Expired — This live share link is no longer active." | Ask the person to generate a new link. |
| Invalid link | Same "Link Expired" page | Verify the URL is correct. |
| Live link limit reached | "Live link limit reached (10)" | Revoke an existing link first. |

### GPS & Connection Issues

| What Happened | What You See | What To Do |
|---|---|---|
| GPS permission denied | "Location access denied" banner | Enable location permission in your browser settings and refresh. |
| GPS unavailable | "Geolocation not supported" | Your browser or device doesn't support GPS. Try a different browser. |
| Lost internet connection | Loading overlay appears: "Connecting..." | Wait for the connection to restore; the app will reconnect automatically. |
| Server restarted | Brief "Connecting..." overlay | The app reconnects automatically. Your contacts' last-known positions are preserved. |

---

## 9. Benefits & Value to the User

### For Families

- **Peace of mind** — Always know where your loved ones are.
- **Emergency response** — One-tap SOS with instant notification to everyone.
- **Child safety** — Check-in system ensures your child confirms they're OK at regular intervals.
- **Elderly care** — Auto-SOS detects if an elderly family member hasn't moved, potentially indicating a fall or medical event.
- **Geofencing** — Know immediately if someone leaves a designated safe area.

### For Friend Groups & Events

- **Event coordination** — Create a room for your group at a festival, hike, or road trip. Everyone can see each other on the map.
- **Temporary sharing** — Generate a live link for a few hours without adding each other as permanent contacts.
- **Distance measurement** — "How far away is everyone?" answered instantly.

### For Personal Safety

- **Solo travelers** — Share your live location with a trusted contact while traveling.
- **Late-night commutes** — Generate a 1-hour live link for your walk home.
- **Emergency sharing** — SOS watch links can be sent to anyone, even people without a Kinnect account — including emergency services.

### Privacy & Control

- **You decide who sees you** — Only contacts you've added, rooms you've joined, and links you've generated reveal your position.
- **Revoke anytime** — Remove a contact, leave a room, or revoke a live link to stop sharing instantly.
- **Temporary by default** — Live links expire. Offline positions expire after 24h.
- **No silent tracking** — When someone adds you as a contact, your visibility to them is part of Kinnect's design. There is no way to track someone without their participation (they must have an account and be actively tracking).

---

## 10. FAQs / Common Scenarios

### Getting Started

**Q: How do I share my location with a family member?**
A: Both of you need Kinnect accounts. Then:
1. Open the Sharing panel and find your Share Code.
2. Give your Share Code to your family member.
3. They enter your code in their Sharing panel to add you as a contact.
4. You do the same with their Share Code.
5. You'll both see each other on the map.

Alternatively, you can add each other by email or mobile number if you registered with those.

---

**Q: What's a Share Code?**
A: A unique 6-character code assigned to your account when you register (e.g., `A3K9BT`). Others use it to add you as a contact. You can find it in the Sharing panel.

---

**Q: Do I need to install an app?**
A: No. Kinnect runs entirely in your web browser. Just open the URL and use it.

---

### Privacy & Sharing

**Q: Can someone track me without my knowledge?**
A: No. For someone to see your location:
- You must have a Kinnect account.
- You must actively start GPS tracking (tap the Track button).
- They must either be your contact, in a shared room with you, or have a live link you generated.

If you stop tracking, close the browser, or remove them as a contact, they can no longer see your live position.

---

**Q: How do I stop sharing my location?**
A: Multiple ways:
- **Stop tracking** — Tap the Track button to stop GPS updates.
- **Remove a contact** — They immediately lose access to your position.
- **Leave a room** — Room members can no longer see you.
- **Revoke a live link** — Viewers are immediately shown "Link Expired."
- **Log out** — Your session ends and tracking stops.

---

**Q: Who can see me right now?**
A: People who can see you include:
- Anyone you've added as a contact (because adding them shares YOUR location with THEM)
- Members of rooms you've joined
- Anyone who has one of your active live links open
- Admins

---

**Q: If I add someone as a contact, can I see them?**
A: Not automatically. When you add someone, **they** can see **you**. For you to see them, they must also add you. This is a deliberate two-way consent design.

---

### Offline & Disconnection

**Q: What happens when I close the browser?**
A: Your marker turns gray (offline) on other people's maps. Your last-known position stays visible for 24 hours by default (or 48 hours if you've opted in). After that, your marker disappears.

---

**Q: What happens when the server restarts (e.g., after an update)?**
A: Your last-known position is saved to the database periodically. When the server comes back up and your contacts reconnect, they'll see your last-known position as an offline marker. Once you reconnect and start tracking, your marker updates to show your live position.

---

**Q: Can I keep my location visible for longer than 24 hours while offline?**
A: Yes. In the Info panel, toggle **"Keep location 48h"** to extend your offline retention to 48 hours. An Admin can also set your retention to **forever** so your last position never expires.

---

### Emergency & SOS

**Q: How does SOS work?**
A: Tap the red SOS button in the top navbar. This instantly:
1. Alerts all your contacts and room members (sound + visual alert).
2. Generates a shareable Watch Link valid for 1 hour.
3. Turns your marker red and pulsing on everyone's map.

Tap "Cancel SOS" when the emergency is over.

---

**Q: Who sees my SOS alert?**
A: Everyone who can see you: contacts who added you, room members, and Admins. You can also share the watch link with anyone — they don't need an account.

---

**Q: What is Auto-SOS?**
A: An Admin can configure rules that automatically trigger SOS for you. For example:
- If you don't move for 5 minutes (no-movement detection — useful for elderly care).
- If you were moving fast and suddenly stopped (hard-stop detection — useful for driving safety).
- If you leave a designated safe zone (geofence breach).

---

**Q: What is a Check-In?**
A: An Admin can set up periodic prompts asking you to confirm you're OK. For example, every 30 minutes, an overlay appears asking you to tap "I'm OK." If you miss the check-in, the Admin is alerted.

---

### Live Links

**Q: What's the difference between a Live Link and adding a contact?**
A:
| | Live Link | Contact |
|---|---|---|
| **Requires account** | No (viewer needs no account) | Yes (both need accounts) |
| **Duration** | Temporary (1h, 6h, 24h, or until revoked) | Permanent until removed |
| **Two-way** | No (one-way: they see you) | Can be mutual if both add each other |
| **Best for** | Sharing with anyone temporarily | Long-term family/friend sharing |

---

**Q: What happens when a live link expires?**
A: Viewers are shown a "Link Expired" card. They can no longer see your position. If they need continued access, you'll need to generate a new link.

---

**Q: How many live links can I have at once?**
A: Up to 10 active live links simultaneously.

---

### Rooms

**Q: What's a Room?**
A: A group sharing space. All members of a room see each other's locations automatically — no need to add each contact individually. Great for trips, events, or family groups.

---

**Q: How do I invite someone to a room?**
A: Share the 6-character Room Code with them (via text, email, etc.). They enter the code in their Sharing panel and tap "Join."

---

**Q: What happens when I leave a room?**
A: You stop seeing other room members (unless they're also your individual contacts). If you're the last person in the room, the room is automatically deleted.

---

**Q: How many rooms can I be in?**
A: Up to 20 rooms simultaneously.

---

### Theme & Interface

**Q: How do I switch between light and dark mode?**
A: Tap the sun/moon icon in the top navbar. The map tiles and UI colors switch immediately. Your preference is saved for future visits.

---

**Q: What are the buttons at the bottom right?**
A:
- **Blue circle (map pin icon):** Start/Stop GPS Tracking.
- **Smaller gray circle (refresh icon):** Reset — clears your tracking path, markers, and distance selections.

---

**Q: How do I log out?**
A: Open the **Info** panel (tap the "i" icon in the navbar). Your name and role are shown at the top. Tap the **Logout** button.

---

## Appendix: Quick Reference Card

| Action | How |
|---|---|
| **Start tracking** | Tap the blue Track button (bottom right) |
| **Stop tracking** | Tap the Track button again (shows stop icon) |
| **Open SOS** | Tap the red SOS button (top navbar, center) |
| **Cancel SOS** | Tap pulsing "Cancel SOS" button |
| **Add a contact** | Sharing panel > Contacts > Enter code/email/mobile > Add |
| **Remove a contact** | Sharing panel > Contacts > Remove |
| **Create a room** | Sharing panel > Rooms > Enter name > Create |
| **Join a room** | Sharing panel > Rooms > Enter code > Join |
| **Leave a room** | Sharing panel > Rooms > Leave |
| **Generate a live link** | Sharing panel > Live Sharing > Generate Link > Choose duration |
| **Revoke a live link** | Sharing panel > Live Sharing > Revoke |
| **Copy your share code** | Sharing panel > My Share Code > Copy |
| **Measure distance** | Users panel > Check two users' boxes |
| **Toggle theme** | Tap sun/moon icon (top navbar, right side) |
| **Log out** | Info panel > Logout |
| **Admin controls** | Info panel > Admin Controls (admin only) |

---

*This guide covers Kinnect version as deployed. For technical documentation or deployment instructions, see the project README.*
