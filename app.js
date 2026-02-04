// Supabase Configuration
const SUPABASE_URL = 'https://ftddwcqsqqvsepqrujkm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0ZGR3Y3FzcXF2c2VwcXJ1amttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyOTIyNjEsImV4cCI6MjA4NDg2ODI2MX0.PoOIh4aCFEVZRA4R-fzKcAe_HUvmz5mpWIbdvhm55I8';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global State
let currentUser = null;
let currentChat = null;
let messageSubscription = null;
let friendsSubscription = null;

// Initialize App
async function initApp() {
    // Check for existing session
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        await handleUserLogin(session.user);
    }

    // Auth state listener
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            await handleUserLogin(session.user);
        } else if (event === 'SIGNED_OUT') {
            handleUserLogout();
        }
    });

    // Event Listeners
    setupEventListeners();
}

// Setup Event Listeners
function setupEventListeners() {
    // Login button
    document.getElementById('login-btn').addEventListener('click', handleLogin);

    // Logout button
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Navigation
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            switchSection(section);
        });
    });

    // Game search
    document.getElementById('game-search').addEventListener('input', handleGameSearch);

    // Game cards
    document.querySelectorAll('.game-card').forEach(card => {
        card.addEventListener('click', () => {
            const url = card.dataset.url;
            const title = card.dataset.title;
            if (url && title) {
                openGame(url, title);
            }
        });
    });

    // Game controls
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
    document.getElementById('exit-game-btn').addEventListener('click', closeGame);

    // Add friend
    document.getElementById('add-friend-btn').addEventListener('click', () => {
        openModal('add-friend-modal');
    });
    document.getElementById('add-friend-submit').addEventListener('click', handleAddFriend);

    // User profile click
    document.getElementById('user-profile-click').addEventListener('click', () => {
        switchSection('profile');
    });

    // Send message
    document.getElementById('send-message-btn').addEventListener('click', sendMessage);
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Invite to game
    document.getElementById('invite-game-btn').addEventListener('click', () => {
        openGameInviteModal();
    });
}

// Authentication
async function handleLogin() {
    const statusEl = document.getElementById('login-status');
    statusEl.textContent = 'Signing in...';
    statusEl.className = 'status-msg';

    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) throw error;
    } catch (error) {
        console.error('Login error:', error);
        statusEl.textContent = 'Login failed. Please try again.';
        statusEl.className = 'status-msg error';
    }
}

async function handleUserLogin(user) {
    // Validate email domain
    if (!user.email.endsWith('@kcpupils.org')) {
        showLoginError('Only @kcpupils.org accounts are allowed.');
        await supabaseClient.auth.signOut();
        return;
    }

    // Check if user is banned
    const { data: accessData } = await supabaseClient
        .from('user_access')
        .select('is_banned')
        .eq('email', user.email)
        .single();

    if (accessData?.is_banned) {
        showLoginError('Access denied. Please contact support.');
        await supabaseClient.auth.signOut();
        return;
    }

    // Create or update user profile
    await createOrUpdateUserProfile(user);

    // Set current user
    currentUser = user;

    // Show main app
    showMainApp();

    // Load user data
    await loadUserProfile();
    await loadFriends();
    await loadConversations();

    // Update online status
    await updateOnlineStatus(true);

    // Setup real-time subscriptions
    setupRealtimeSubscriptions();
}

async function createOrUpdateUserProfile(user) {
    const { error } = await supabaseClient
        .from('users')
        .upsert({
            email: user.email,
            name: user.user_metadata.full_name || user.email.split('@')[0],
            avatar_url: user.user_metadata.avatar_url || '',
            last_seen: new Date().toISOString(),
            is_online: true
        }, {
            onConflict: 'email'
        });

    if (error) {
        console.error('Error creating/updating user profile:', error);
    }
}

function showLoginError(message) {
    const statusEl = document.getElementById('login-status');
    statusEl.textContent = message;
    statusEl.className = 'status-msg error';
}

function showMainApp() {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
}

async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        await updateOnlineStatus(false);
        await supabaseClient.auth.signOut();
    }
}

function handleUserLogout() {
    currentUser = null;
    currentChat = null;
    
    // Cleanup subscriptions
    if (messageSubscription) {
        messageSubscription.unsubscribe();
    }
    if (friendsSubscription) {
        friendsSubscription.unsubscribe();
    }

    // Reload page
    window.location.reload();
}

// User Profile
async function loadUserProfile() {
    const { data: userData } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', currentUser.email)
        .single();

    if (userData) {
        // Update sidebar
        document.getElementById('sidebar-name').textContent = userData.name;
        document.getElementById('sidebar-email').textContent = userData.email;
        document.getElementById('sidebar-avatar').src = userData.avatar_url || 'https://via.placeholder.com/48';

        // Update profile page
        document.getElementById('profile-name').textContent = userData.name;
        document.getElementById('profile-email').textContent = userData.email;
        document.getElementById('profile-avatar').src = userData.avatar_url || 'https://via.placeholder.com/120';

        // Load stats
        await loadUserStats();
    }
}

async function loadUserStats() {
    // Get friends count
    const { count: friendsCount } = await supabaseClient
        .from('friends')
        .select('*', { count: 'exact', head: true })
        .eq('user_email', currentUser.email)
        .eq('status', 'accepted');

    document.getElementById('friends-count').textContent = friendsCount || 0;

    // Get games played (you can implement this based on your tracking)
    document.getElementById('games-played').textContent = '0';
    document.getElementById('total-time').textContent = '0h';
}

async function updateOnlineStatus(isOnline) {
    const { error } = await supabaseClient
        .from('users')
        .update({
            is_online: isOnline,
            last_seen: new Date().toISOString()
        })
        .eq('email', currentUser.email);

    if (error) {
        console.error('Error updating online status:', error);
    }
}

// Friends Management
async function loadFriends() {
    const { data: friendsData, error } = await supabaseClient
        .from('friends')
        .select(`
            friend_email,
            status,
            users!friends_friend_email_fkey (
                name,
                avatar_url,
                is_online,
                current_game
            )
        `)
        .eq('user_email', currentUser.email)
        .eq('status', 'accepted');

    if (error) {
        console.error('Error loading friends:', error);
        return;
    }

    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = '';

    if (!friendsData || friendsData.length === 0) {
        friendsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-friends"></i>
                <h3>No Friends Yet</h3>
                <p>Add friends to get started</p>
            </div>
        `;
        return;
    }

    friendsData.forEach(friend => {
        const userData = friend.users;
        const friendItem = document.createElement('div');
        friendItem.className = 'friend-item';
        friendItem.onclick = () => openChat(friend.friend_email);
        
        friendItem.innerHTML = `
            <div style="position: relative;">
                <img class="friend-avatar" src="${userData?.avatar_url || 'https://via.placeholder.com/40'}" alt="Friend">
                <div class="friend-status ${userData?.is_online ? 'online' : ''}"></div>
            </div>
            <div class="friend-info">
                <div class="friend-name">${userData?.name || friend.friend_email.split('@')[0]}</div>
                <div class="friend-game">${userData?.current_game || (userData?.is_online ? 'Online' : 'Offline')}</div>
            </div>
        `;
        
        friendsList.appendChild(friendItem);
    });
}

async function handleAddFriend() {
    const emailInput = document.getElementById('friend-email-input');
    const email = emailInput.value.trim().toLowerCase();

    if (!email) {
        alert('Please enter an email address.');
        return;
    }

    if (!email.endsWith('@kcpupils.org')) {
        alert('Only @kcpupils.org accounts can be added.');
        return;
    }

    if (email === currentUser.email) {
        alert('You cannot add yourself as a friend.');
        return;
    }

    // Check if user exists
    const { data: userData } = await supabaseClient
        .from('users')
        .select('email')
        .eq('email', email)
        .single();

    if (!userData) {
        alert('User not found. Make sure they have signed in at least once.');
        return;
    }

    // Check if already friends
    const { data: existingFriend } = await supabaseClient
        .from('friends')
        .select('*')
        .eq('user_email', currentUser.email)
        .eq('friend_email', email)
        .single();

    if (existingFriend) {
        alert('This user is already your friend or a request is pending.');
        return;
    }

    // Add friend
    const { error } = await supabaseClient
        .from('friends')
        .insert({
            user_email: currentUser.email,
            friend_email: email,
            status: 'accepted'
        });

    if (error) {
        console.error('Error adding friend:', error);
        alert('Failed to add friend. Please try again.');
        return;
    }

    // Add reciprocal friendship
    await supabaseClient
        .from('friends')
        .insert({
            user_email: email,
            friend_email: currentUser.email,
            status: 'accepted'
        });

    emailInput.value = '';
    closeModal('add-friend-modal');
    alert('Friend added successfully!');
    await loadFriends();
}

// Messages
async function loadConversations() {
    const { data: messagesData } = await supabaseClient
        .from('messages')
        .select(`
            sender_email,
            recipient_email,
            message,
            created_at,
            is_read
        `)
        .or(`sender_email.eq.${currentUser.email},recipient_email.eq.${currentUser.email}`)
        .order('created_at', { ascending: false })
        .limit(100);

    if (!messagesData || messagesData.length === 0) {
        return;
    }

    // Group messages by conversation
    const conversations = {};
    messagesData.forEach(msg => {
        const otherUser = msg.sender_email === currentUser.email ? msg.recipient_email : msg.sender_email;
        
        if (!conversations[otherUser]) {
            conversations[otherUser] = {
                email: otherUser,
                lastMessage: msg.message,
                lastMessageTime: msg.created_at,
                unread: msg.recipient_email === currentUser.email && !msg.is_read
            };
        }
    });

    // Display conversations
    const conversationsList = document.getElementById('conversations-list');
    conversationsList.innerHTML = '';

    for (const email in conversations) {
        const conv = conversations[email];
        
        // Get user data
        const { data: userData } = await supabaseClient
            .from('users')
            .select('name, avatar_url')
            .eq('email', email)
            .single();

        const convItem = document.createElement('div');
        convItem.className = 'conversation-item';
        convItem.onclick = () => openChat(email);
        
        convItem.innerHTML = `
            <img class="conversation-avatar" src="${userData?.avatar_url || 'https://via.placeholder.com/48'}" alt="User">
            <div class="conversation-info">
                <h4 class="conversation-name">${userData?.name || email.split('@')[0]}</h4>
                <p class="conversation-preview">${conv.lastMessage}</p>
            </div>
            ${conv.unread ? '<div class="message-indicator">1</div>' : ''}
        `;
        
        conversationsList.appendChild(convItem);
    }
}

async function openChat(friendEmail) {
    currentChat = friendEmail;
    
    // Switch to messages section
    switchSection('messages');

    // Get friend data
    const { data: friendData } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', friendEmail)
        .single();

    // Update chat header
    document.getElementById('chat-avatar').src = friendData?.avatar_url || 'https://via.placeholder.com/48';
    document.getElementById('chat-name').textContent = friendData?.name || friendEmail.split('@')[0];
    document.getElementById('chat-status').textContent = friendData?.is_online ? 'Online' : 'Offline';

    // Show chat area
    document.getElementById('chat-area').style.display = 'flex';

    // Load messages
    await loadMessages(friendEmail);

    // Mark messages as read
    await markMessagesAsRead(friendEmail);

    // Set active conversation
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.classList.remove('active');
    });
}

async function loadMessages(friendEmail) {
    const { data: messagesData } = await supabaseClient
        .from('messages')
        .select('*')
        .or(`and(sender_email.eq.${currentUser.email},recipient_email.eq.${friendEmail}),and(sender_email.eq.${friendEmail},recipient_email.eq.${currentUser.email})`)
        .order('created_at', { ascending: true });

    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';

    if (!messagesData || messagesData.length === 0) {
        chatMessages.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comments"></i>
                <h3>No messages yet</h3>
                <p>Start the conversation!</p>
            </div>
        `;
        return;
    }

    messagesData.forEach(msg => {
        const messageEl = createMessageElement(msg);
        chatMessages.appendChild(messageEl);
    });

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createMessageElement(message) {
    const isSent = message.sender_email === currentUser.email;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : ''}`;

    const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let content = `
        <img class="message-avatar" src="${currentUser.user_metadata?.avatar_url || 'https://via.placeholder.com/36'}" alt="Avatar">
        <div>
            <div class="message-content">
                <p class="message-text">${escapeHtml(message.message)}</p>
                <p class="message-time">${time}</p>
            </div>
    `;

    if (message.game_invite) {
        const gameData = JSON.parse(message.game_invite);
        content += `
            <div class="game-invite">
                <p class="game-invite-title">🎮 ${gameData.title}</p>
                <button class="join-game-btn" onclick="joinGame('${gameData.url}', '${gameData.title}')">
                    Join Game
                </button>
            </div>
        `;
    }

    content += '</div>';
    messageDiv.innerHTML = content;

    return messageDiv;
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (!message || !currentChat) return;

    const { error } = await supabaseClient
        .from('messages')
        .insert({
            sender_email: currentUser.email,
            recipient_email: currentChat,
            message: message,
            is_read: false
        });

    if (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Please try again.');
        return;
    }

    input.value = '';
    await loadMessages(currentChat);
}

async function markMessagesAsRead(friendEmail) {
    await supabaseClient
        .from('messages')
        .update({ is_read: true })
        .eq('sender_email', friendEmail)
        .eq('recipient_email', currentUser.email)
        .eq('is_read', false);
}

// Game Invites
function openGameInviteModal() {
    if (!currentChat) {
        alert('Please select a friend to invite.');
        return;
    }

    const gameList = document.getElementById('game-select-list');
    gameList.innerHTML = '';

    // Get all games
    const gameCards = document.querySelectorAll('.game-card');
    gameCards.forEach(card => {
        const title = card.dataset.title;
        const url = card.dataset.url;
        
        const gameItem = document.createElement('div');
        gameItem.className = 'friend-item';
        gameItem.style.marginBottom = '10px';
        gameItem.onclick = () => sendGameInvite(title, url);
        
        gameItem.innerHTML = `
            <i class="fas fa-gamepad" style="font-size: 24px; color: var(--primary);"></i>
            <div class="friend-info">
                <div class="friend-name">${title}</div>
            </div>
        `;
        
        gameList.appendChild(gameItem);
    });

    openModal('game-invite-modal');
}

async function sendGameInvite(gameTitle, gameUrl) {
    const inviteData = {
        title: gameTitle,
        url: gameUrl
    };

    const { error } = await supabaseClient
        .from('messages')
        .insert({
            sender_email: currentUser.email,
            recipient_email: currentChat,
            message: `🎮 Invited you to play ${gameTitle}`,
            game_invite: JSON.stringify(inviteData),
            is_read: false
        });

    if (error) {
        console.error('Error sending game invite:', error);
        alert('Failed to send invite. Please try again.');
        return;
    }

    closeModal('game-invite-modal');
    await loadMessages(currentChat);
    alert('Game invite sent!');
}

function joinGame(url, title) {
    openGame(url, title);
}

// Real-time Subscriptions
function setupRealtimeSubscriptions() {
    // Subscribe to messages
    messageSubscription = supabaseClient
        .channel('messages')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `recipient_email=eq.${currentUser.email}`
        }, (payload) => {
            if (currentChat === payload.new.sender_email) {
                const messageEl = createMessageElement(payload.new);
                document.getElementById('chat-messages').appendChild(messageEl);
                document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
                markMessagesAsRead(currentChat);
            }
            loadConversations();
        })
        .subscribe();

    // Subscribe to friend status changes
    friendsSubscription = supabaseClient
        .channel('users')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'users'
        }, () => {
            loadFriends();
        })
        .subscribe();
}

// Game Management
function openGame(url, title) {
    document.getElementById('game-iframe').src = url;
    document.getElementById('current-game-title').textContent = title;
    document.getElementById('game-container').style.display = 'flex';
    document.title = `${title} - Maths Support`;

    // Update current game status
    updateCurrentGame(title);
}

function closeGame() {
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('game-iframe').src = '';
    document.title = 'Maths Support';

    // Clear current game status
    updateCurrentGame(null);
}

function toggleFullscreen() {
    const container = document.getElementById('game-iframe-container');
    
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            console.error('Fullscreen error:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

async function updateCurrentGame(gameName) {
    await supabaseClient
        .from('users')
        .update({ current_game: gameName })
        .eq('email', currentUser.email);
}

function handleGameSearch(e) {
    const query = e.target.value.toLowerCase();
    const gameCards = document.querySelectorAll('.game-card');

    gameCards.forEach(card => {
        const searchText = card.dataset.search || '';
        const title = card.dataset.title || '';
        
        if (searchText.toLowerCase().includes(query) || title.toLowerCase().includes(query)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// Navigation
function switchSection(sectionName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === sectionName) {
            item.classList.add('active');
        }
    });

    // Update sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(`${sectionName}-section`).classList.add('active');
}

// Modal Management
function openModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle page visibility for online status
document.addEventListener('visibilitychange', () => {
    if (currentUser) {
        updateOnlineStatus(!document.hidden);
    }
});

// Handle before unload
window.addEventListener('beforeunload', () => {
    if (currentUser) {
        updateOnlineStatus(false);
    }
});

// Initialize app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
