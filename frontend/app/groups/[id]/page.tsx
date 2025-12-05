'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getSocket, initSocket } from '@/lib/socket';
import api from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Send, Smile, Ban, Flag, Upload, Download, Palette, Clock, LogOut, Users, MoreVertical, Edit3, Trash2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import EmojiPicker, { EmojiClickData } from 'emoji-picker-react';
import { toast } from 'sonner';
interface Message {
  _id: string;
  anonymousName: string;
  senderName?: string;
  senderId?: string;
  content: string;
  createdAt: string;
  userId?: string;
  isFile?: boolean;
  fileName?: string;
  fileContent?: string;
  fileSize?: number;
  edited?: boolean;
  isDeleted?: boolean;
  autoDelete?: {
    enabled: boolean;
    deleteAfter: number | null;
    expiresAt: string | null;
    isDeleted?: boolean;
    deletedAt?: string | null;
  };
}

// Auto-delete timer component
function AutoDeleteTimer({ expiresAt, messageId }: { expiresAt: string | null, messageId: string }) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const now = Date.now();
      const expiry = new Date(expiresAt).getTime();
      const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
      setTimeLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt || timeLeft <= 0) {
    return (
      <div className="flex items-center gap-1 text-xs opacity-70">
        <Clock className="w-3 h-3" />
        <span>Auto-deletes</span>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  return (
    <div className="flex items-center gap-1 text-xs opacity-70">
      <Clock className="w-3 h-3" />
      <span>Deletes in {formatTime(timeLeft)}</span>
    </div>
  );
}

export default function GroupChatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const groupId = params.id as string;
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [group, setGroup] = useState<any>(null);
  const [anonymousName, setAnonymousName] = useState('');
  const [userName, setUserName] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set()); // Users I have blocked
  const [usersWhoBlockedMe, setUsersWhoBlockedMe] = useState<Set<string>>(new Set()); // Users who blocked me
  const [allUsersInGroup, setAllUsersInGroup] = useState<Array<{userId: string, anonymousName: string}>>([]);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportUserId, setReportUserId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [showBlockedUsersDialog, setShowBlockedUsersDialog] = useState(false);
  const [blockedUsersList, setBlockedUsersList] = useState<Array<{userId: string, anonymousName: string}>>([]);
  const [groupTheme, setGroupTheme] = useState<string>('default');
  const [showThemeDialog, setShowThemeDialog] = useState(false);
  const [showMembersDialog, setShowMembersDialog] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<string>('default');
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState(false);
  const [autoDeleteTime, setAutoDeleteTime] = useState<number>(60); // Default 60 seconds
  const [showAutoDeleteMenu, setShowAutoDeleteMenu] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [presenceMap, setPresenceMap] = useState<Map<string, { isOnline: boolean; lastActive?: string | null }>>(new Map());
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Helper to keep `allUsersInGroup` in sync with currently loaded messages.
  // This is used mainly for dialogs (e.g. blocked users) where we need to
  // resolve a userId/anonymousName even if they are not present in the
  // latest group members list.
  const fetchAllUsersFromMessages = () => {
    setAllUsersInGroup((prev) => {
      const userMap = new Map(prev.map((u) => [u.userId, u]));

      messages.forEach((message) => {
        if (message.userId) {
          const userId = message.userId.toString();
          if (!userMap.has(userId)) {
            userMap.set(userId, {
              userId,
              anonymousName: message.anonymousName,
            });
          }
        }
      });

      return Array.from(userMap.values());
    });
  };

  // Smooth-scroll to a message by id
  const scrollToMessageById = (id: string) => {
    const el = document.getElementById(`message-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      toast.error('Message not loaded in view');
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
      return;
    }
    if (user && groupId) {
      const initialize = async () => {
        try {
          // Try to fetch group first
          let groupResponse;
          try {
            groupResponse = await api.get(`/groups/${groupId}`);
          } catch (fetchError: any) {
            // If user is not a member (403), try to auto-join
            if (fetchError.response?.status === 403 && 
                fetchError.response?.data?.message?.includes('Not a member')) {
              try {
                // Try to join the group
                await api.post('/groups/join', { groupId });
                // Retry fetching the group after joining
                groupResponse = await api.get(`/groups/${groupId}`);
                toast.success('Successfully joined the channel!');
              } catch (joinError: any) {
                // If join fails, show error and redirect
                const errorMsg = joinError.response?.data?.message || 'Failed to join channel';
                toast.error(errorMsg);
                router.push('/groups');
                return;
              }
            } else {
              // For other errors, throw to be handled below
              throw fetchError;
            }
          }
          
          if (!groupResponse?.data || !groupResponse.data.group) {
            throw new Error('Invalid response from server');
          }
          
          const groupData = groupResponse.data.group;
          
          // Set group state
          setGroup(groupData);
          setAnonymousName(groupData.userAnonymousName || 'Admin');
          setUserName(user?.name || '');
          setMemberCount(groupData.members?.length || 0);
          setGroupTheme(groupData.theme || 'default');
          setSelectedTheme(groupData.theme || 'default');
          
          // Extract all users from group members
          if (groupData.members) {
            const users = groupData.members
              .filter((m: any) => m.userId)
              .map((m: any) => ({
                userId: m.userId.toString(),
                name: m.name || m.anonymousName || 'Unknown'
              }));
            setAllUsersInGroup(prev => {
              const userMap = new Map(prev.map(u => [u.userId, u]));
              users.forEach((u: any) => userMap.set(u.userId, u));
              return Array.from(userMap.values());
            });
          }
          
          // Now fetch blocked users with the group data
          await fetchBlockedUsers(groupData);
          
          // Fetch messages and setup socket
          fetchMessages();
          fetchAllUsersFromMessages();
          setupSocket();
        } catch (error: any) {
          console.error('Initialization error:', error);
          const errorMessage = error.response?.data?.message || error.message || 'Failed to load channel';
          
          if (error.response?.status === 403 && error.response?.data?.message?.includes('removed')) {
            toast.error('You have been removed from this channel');
            router.push('/groups');
            return;
          }
          if (error.response?.status === 404) {
            toast.error('Channel not found');
            router.push('/groups');
            return;
          }
          toast.error(errorMessage);
        }
      };
      initialize();
    }
    return () => {
      const socket = getSocket();
      if (socket) {
        socket.emit('leave-group', groupId);
      }
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [loading, user, groupId, router]);

  // Presence removed

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchAllUsersFromMessages();
  }, [messages]);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchGroup = async () => {
    try {
      const response = await api.get(`/groups/${groupId}`);
      setGroup(response.data.group);
      setAnonymousName(response.data.group.userAnonymousName || 'Admin');
      setMemberCount(response.data.group.members?.length || 0);
      setGroupTheme(response.data.group.theme || 'default');
      setSelectedTheme(response.data.group.theme || 'default');
      
      // Extract all users from group members
      if (response.data.group.members) {
        const users = response.data.group.members
          .filter((m: any) => m.userId)
          .map((m: any) => ({
            userId: m.userId.toString(),
            anonymousName: m.anonymousName,
            isOnline: m.isOnline,
            lastActive: m.lastActive
          }));
        setAllUsersInGroup(prev => {
          const userMap = new Map(prev.map(u => [u.userId, u]));
          users.forEach((u: any) => userMap.set(u.userId, u));
          return Array.from(userMap.values());
        });
        setPresenceMap(() => {
          const map = new Map<string, { isOnline: boolean; lastActive?: string | null }>();
          users.forEach((u: any) => {
            map.set(u.userId, { isOnline: !!u.isOnline, lastActive: u.lastActive });
          });
          return map;
        });
      }
    } catch (err: any) {
      console.error('Failed to fetch channel:', err);
      if (err.response?.status === 403 && err.response?.data?.message?.includes('removed')) {
        toast.error('You have been removed from this channel');
        router.push('/groups');
      }
    }
  };

  const fetchMessages = async () => {
    try {
      const response = await api.get(`/messages/group/${groupId}`);
      // Backend already filters based on mutual blocking, but we'll also filter on frontend for safety
      const filteredMessages = response.data.messages.filter((message: Message) => {
        // Don't show messages that are marked as deleted
        if (message.autoDelete?.isDeleted) {
          return false;
        }
        if (!message.userId) return true;
        const messageUserId = message.userId.toString();
        // Don't show messages from users I blocked
        if (blockedUsers.has(messageUserId)) return false;
        // Don't show messages from users who blocked me
        if (usersWhoBlockedMe.has(messageUserId)) return false;
        return true;
      });
      setMessages(filteredMessages);
    } catch (err: any) {
      console.error('Failed to fetch messages:', err);
      if (err.response?.status === 403 && err.response?.data?.message?.includes('removed')) {
        toast.error('You have been removed from this channel');
        router.push('/groups');
      }
    }
  };

  const fetchBlockedUsers = async (groupData?: any) => {
    try {
      // Get users I have blocked
      const blockedResponse = await api.get('/block/blocked');
      const blockedSet = new Set<string>(
        blockedResponse.data.blockedUsers.map((b: any) => b.blockedUserId.toString())
      );
  
      // MUST be typed as Set<string>
      const usersWhoBlockedMeSet = new Set<string>();
  
      // Use passed groupData or current group state
      const currentGroup = groupData || group;
  
      // Check each user in the group to see if they blocked me
      if (currentGroup?.members && user?.id) {
        for (const member of currentGroup.members) {
          if (member.userId && member.userId.toString() !== user.id) {
            try {
              const checkResponse = await api.get(`/block/check/${member.userId}`);
              if (checkResponse.data.blockedByThem) {
                usersWhoBlockedMeSet.add(member.userId.toString());
              }
            } catch (err) {
              // Continue checking other members
            }
          }
        }
      }
  
      // Now update states
      setBlockedUsers(blockedSet);
      setUsersWhoBlockedMe(usersWhoBlockedMeSet);
  
      // Build blocked-users list for dialog
      const blockedList: Array<{ userId: string; anonymousName: string }> = [];

      Array.from(blockedSet).forEach((blockedUserId) => {
        const found =
          allUsersInGroup.find((u) => u.userId === blockedUserId) ||
          currentGroup?.members?.find(
            (m: any) =>
              m.userId && m.userId.toString() === blockedUserId
          );
        if (found) {
          blockedList.push({
            userId: blockedUserId,
            anonymousName: found.anonymousName || found.name || 'Unknown',
          });
        }
      });
  
      setBlockedUsersList(blockedList);
    } catch (err) {
      console.error('Failed to fetch blocked users:', err);
    }
  };
  

  const handleBlockUser = async (userId: string) => {
    try {
      const targetUserId = userId;

      await api.post('/block/block', { userId: targetUserId });
      toast.success('User blocked successfully');
      setBlockedUsers(prev => {
        const newSet = new Set(prev);
        newSet.add(targetUserId);
        return newSet;
      });
      await fetchBlockedUsers();
      fetchMessages(); // Reload messages to hide blocked user's messages
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to block user');
    }
  };

  const handleUnblockUser = async (userId: string) => {
    try {
      const targetUserId = userId;

      await api.post('/block/unblock', { userId: targetUserId });
      toast.success('User unblocked successfully');
      setBlockedUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(targetUserId);
        return newSet;
      });
      await fetchBlockedUsers();
      fetchMessages(); // Reload messages to show unblocked user's messages
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to unblock user');
    }
  };

  const handleReportUser = async () => {
    if (!reportUserId || !reportReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    
    try {
      const targetUserId = reportUserId;

      await api.post('/block/report', {
        userId: targetUserId,
        reason: reportReason,
        description: reportDescription
      });
      toast.success('User reported successfully');
      setShowReportDialog(false);
      setReportUserId(null);
      setReportReason('');
      setReportDescription('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to report user');
    }
  };

  const handleStartEdit = (message: Message) => {
    setEditingMessageId(message._id);
    setEditingText(message.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  const handleSaveEdit = async () => {
    if (!editingMessageId) return;
    const text = editingText.trim();
    if (!text) {
      toast.error('Message cannot be empty');
      return;
    }
    try {
      const response = await api.patch(`/messages/${editingMessageId}`, { text });
      const updated = response.data?.message;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === editingMessageId
            ? { ...m, content: updated?.text || text, edited: true }
            : m
        )
      );
      setEditingMessageId(null);
      setEditingText('');
      toast.success('Message updated');
      if (updated?._id) {
        scrollToMessageById(updated._id);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to edit message');
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await api.delete(`/messages/${messageId}`);
      setMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? { ...m, content: 'This message was deleted.', isDeleted: true }
            : m
        )
      );
      toast.success('Message deleted');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete message');
    }
  };

  const handleRemoveUser = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this user from the channel? They will lose access to all channel messages.')) {
      return;
    }
    
    try {
      await api.post(`/groups/${groupId}/remove-user`, { userId });
      toast.success('User removed from channel successfully');
      await fetchGroup();
      fetchMessages();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to remove user');
    }
  };

  // Fetch members with live presence when members dialog opens
  useEffect(() => {
    const fetchMembers = async () => {
      if (!showMembersDialog) return;
      try {
        const res = await api.get(`/groups/${groupId}/members`);
        const members = res.data?.members || [];
        setGroup((prev: any) => prev ? { ...prev, members } : prev);
        setPresenceMap(() => {
          const map = new Map<string, { isOnline: boolean; lastActive?: string | null }>();
          members.forEach((m: any) => map.set(m.userId, { isOnline: !!m.isOnline, lastActive: m.lastActive }));
          return map;
        });
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Failed to load members');
      }
    };
    fetchMembers();
  }, [showMembersDialog, groupId]);


  const getUserFromMessage = (anonymousName: string, userId?: string) => {
    // First try to find by userId if available
    if (userId && group?.members) {
      const found = group.members.find((m: any) => m.userId && m.userId.toString() === userId.toString());
      if (found) return found;
    }
    
    // Fallback to finding by anonymousName
    if (group?.members) {
      return group.members.find((m: any) => m.anonymousName === anonymousName);
    }
    
    // Check in allUsersInGroup
    const found = allUsersInGroup.find(u => u.anonymousName === anonymousName);
    if (found) {
      return { userId: found.userId, anonymousName: found.anonymousName };
    }
    
    return null;
  };


  const setupSocket = () => {
    let socket = getSocket();
    if (!socket || !socket.connected) {
      const token = sessionStorage.getItem('token');
      if (token) {
        socket = initSocket(token);
      } else {
        return;
      }
    }

    socket.emit('join-group', groupId);

    socket.off('presence:update');

    socket.on('joined-group', (data: { userName?: string, anonymousName?: string }) => {
      if (data.anonymousName) {
        setAnonymousName(data.anonymousName);
      }
      if (data.userName) {
        setUserName(data.userName);
      }
    });

    socket.off('message:edited');
    socket.off('message:deleted');
    socket.off('presence:update');

    socket.on('new-message', (message: Message) => {
      // Don't add messages if the sender is the current user (they'll get it via message-sent)
      if (message.userId === user?.id) {
        return;
      }
      
      // Don't show messages that are marked as deleted
      if (message.autoDelete?.isDeleted) {
        return;
      }
      
      // Check if message is from a blocked user or user who blocked me
      if (message.userId) {
        const messageUserId = message.userId.toString();
        if (blockedUsers.has(messageUserId) || usersWhoBlockedMe.has(messageUserId)) {
          return; // Don't add blocked messages
        }
      }
      
      setMessages((prev) => {
        // Check if message already exists to prevent duplicates
        const exists = prev.some(m => m._id === message._id);
        if (exists) return prev;
        return [...prev, message];
      });
      
      // Update users list when new message arrives
      fetchAllUsersFromMessages();
    });

    socket.on('message-sent', (message: Message) => {
      // Add message from server (sender's own message)
      setMessages((prev) => {
        // Check if message already exists to prevent duplicates
        const exists = prev.some(m => m._id === message._id);
        if (exists) return prev;
        return [...prev, message];
      });
    });

    socket.on('message:edited', (data: any) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === data._id
            ? {
                ...m,
                content: data.text || data.content,
                edited: true,
              }
            : m
        )
      );
    });

    socket.on('message:deleted', (data: { id: string; groupId?: string }) => {
      const targetId = data.id;
      setMessages((prev) =>
        prev.map((m) =>
          m._id === targetId
            ? { ...m, content: 'This message was deleted.', isDeleted: true }
            : m
        )
      );
    });

    socket.on('presence:update', (data: { userId: string; isOnline: boolean; lastActive?: string }) => {
      setPresenceMap((prev) => {
        const map = new Map(prev);
        map.set(data.userId, { isOnline: data.isOnline, lastActive: data.lastActive });
        return map;
      });
      // Also update group members if present
      setGroup((prev: any) => {
        if (!prev || !prev.members) return prev;
        const members = prev.members.map((m: any) =>
          m.userId === data.userId ? { ...m, isOnline: data.isOnline, lastActive: data.lastActive } : m
        );
        return { ...prev, members };
      });
    });

    socket.on('member-count-updated', (data: { memberCount: number, members: Array<{ anonymousName: string, userId?: string }> }) => {
      setMemberCount(data.memberCount);
      // Update group members if needed
      if (group) {
        setGroup({ ...group, members: data.members });
      }
      // Update users list when members change
      fetchGroup();
    });

    socket.on('user-joined', (data: { anonymousName: string, userId?: string }) => {
      // Update users list when new user joins
      fetchGroup();
    });

    socket.on('error', (error: { message: string }) => {
      console.error('Socket error:', error);
      if (error.message?.includes('removed')) {
        toast.error('You have been removed from this channel');
        router.push('/groups');
      } else {
        toast.error(error.message || 'An error occurred');
      }
    });

    // Listen for user removal
    socket.on('removed-from-group', (data: { groupId: string, groupName: string }) => {
      if (data.groupId === groupId) {
        toast.error(`You have been removed from channel ${data.groupName}`);
        router.push('/groups');
      }
    });

    // Listen for block/unblock updates
    socket.on('user-blocked-update', async () => {
      await fetchBlockedUsers();
      fetchMessages();
    });

    socket.on('user-unblocked-update', async () => {
      await fetchBlockedUsers();
      fetchMessages();
    });

    // Listen for theme updates
    socket.on('theme-updated', (data: { groupId: string, theme: string }) => {
      if (data.groupId === groupId) {
        setGroupTheme(data.theme);
        setSelectedTheme(data.theme);
      }
    });

    // Listen for auto-deleted messages
    socket.on('messages-deleted', (data: { messageIds: string[], groupId: string }) => {
      if (data.groupId === groupId) {
        setMessages((prev) => prev.filter(m => !data.messageIds.includes(m._id)));
      }
    });

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const s = getSocket();
      if (s && s.connected) {
        s.emit('presence:ping');
      }
    }, 25000);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    // Check if trying to send to blocked users (backend will also check, but this prevents unnecessary sends)
    // Note: We can't check all recipients here, so backend validation is the source of truth

    const messageContent = newMessage.trim();
    setNewMessage('');
    setShowEmojiPicker(false);

    let socket = getSocket();
    if (!socket || !socket.connected) {
      const token = sessionStorage.getItem('token');
      if (token) {
        socket = initSocket(token);
      } else {
        return;
      }
    }

    socket.emit('send-message', {
      groupId,
      content: messageContent,
      autoDelete: {
        enabled: autoDeleteEnabled,
        deleteAfter: autoDeleteEnabled ? autoDeleteTime : null
      }
    });
  };

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setNewMessage((prev) => prev + emojiData.emoji);
    inputRef.current?.focus();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only allow text files
    if (!file.type.startsWith('text/') && !file.name.endsWith('.txt') && !file.name.endsWith('.md') && !file.name.endsWith('.json') && !file.name.endsWith('.js') && !file.name.endsWith('.ts') && !file.name.endsWith('.tsx') && !file.name.endsWith('.jsx') && !file.name.endsWith('.css') && !file.name.endsWith('.html') && !file.name.endsWith('.xml')) {
      toast.error('Only text files are allowed');
      return;
    }

    // Limit file size to 100KB
    if (file.size > 100 * 1024) {
      toast.error('File size must be less than 100KB');
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const fileContent = event.target?.result as string;
        
        let socket = getSocket();
        if (!socket || !socket.connected) {
          const token = sessionStorage.getItem('token');
          if (token) {
            socket = initSocket(token);
          } else {
            toast.error('Connection error');
            return;
          }
        }

        socket.emit('send-message', {
          groupId,
          content: `Shared file: ${file.name}`,
          isFile: true,
          fileName: file.name,
          fileContent: fileContent,
          fileSize: file.size,
          autoDelete: {
            enabled: autoDeleteEnabled,
            deleteAfter: autoDeleteEnabled ? autoDeleteTime : null
          }
        });

        toast.success('File shared successfully');
      };
      reader.onerror = () => {
        toast.error('Failed to read file');
      };
      reader.readAsText(file);
    } catch (err: any) {
      toast.error('Failed to upload file');
    }

    // Reset file input
    if (fileInput.current) {
      fileInput.current.value = '';
    }
  };

  const handleDownloadFile = (message: Message) => {
    if (!message.fileContent || !message.fileName) return;

    const blob = new Blob([message.fileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = message.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleThemeChange = async () => {
    try {
      await api.put(`/groups/${groupId}/theme`, { theme: selectedTheme });
      setGroupTheme(selectedTheme);
      setShowThemeDialog(false);
      toast.success('Theme updated successfully');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update theme');
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm('Are you sure you want to leave this channel? You will need to join again using the channel code to access it.')) {
      return;
    }

    try {
      await api.delete(`/groups/${groupId}/leave`);
      toast.success('Left channel successfully');
      router.push('/groups');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to leave channel');
    }
  };

  // Theme color mapping
  const themeColors: Record<string, { bg: string; text: string; border: string; primary: string; messageText: string }> = {
    default: { bg: 'bg-background', text: 'text-foreground', border: 'border-border', primary: 'bg-primary', messageText: 'text-foreground' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-900 dark:text-blue-100', border: 'border-blue-200 dark:border-blue-800', primary: 'bg-blue-600', messageText: 'text-blue-900 dark:text-blue-100' },
    green: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-900 dark:text-green-100', border: 'border-green-200 dark:border-green-800', primary: 'bg-green-600', messageText: 'text-green-900 dark:text-green-100' },
    purple: { bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-900 dark:text-purple-100', border: 'border-purple-200 dark:border-purple-800', primary: 'bg-purple-600', messageText: 'text-purple-900 dark:text-purple-100' },
    orange: { bg: 'bg-orange-50 dark:bg-orange-950', text: 'text-orange-900 dark:text-orange-100', border: 'border-orange-200 dark:border-orange-800', primary: 'bg-orange-600', messageText: 'text-orange-900 dark:text-orange-100' },
    red: { bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-900 dark:text-red-100', border: 'border-red-200 dark:border-red-800', primary: 'bg-red-600', messageText: 'text-red-900 dark:text-red-100' },
    pink: { bg: 'bg-pink-50 dark:bg-pink-950', text: 'text-pink-900 dark:text-pink-100', border: 'border-pink-200 dark:border-pink-800', primary: 'bg-pink-600', messageText: 'text-pink-900 dark:text-pink-100' },
    grey: { bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-900 dark:text-gray-100', border: 'border-gray-200 dark:border-gray-700', primary: 'bg-gray-600', messageText: 'text-gray-900 dark:text-gray-100' }
  };

  const currentTheme = themeColors[groupTheme] || themeColors.default;

  const formatLastSeen = (date?: string | null) => {
    if (!date) return 'Unknown';
    const d = new Date(date);
    return `Last seen ${d.toLocaleTimeString()}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  if (!user || !group) {
    return <div className="container">Loading channel...</div>;
  }

  const membersList: Array<{ userId?: string; anonymousName: string; name?: string }> = (group?.members || []).map((m: any) => ({
    userId: m.userId ? m.userId.toString() : undefined,
    anonymousName: m.anonymousName || 'Unknown',
    name: m.name || (m.userId && m.userId.name) || undefined,
  }));

  return (
    <div className={`h-screen ${currentTheme.bg} ${currentTheme.text} flex flex-col`}>
      <div className={`border-b ${currentTheme.border} p-4`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/groups')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div>
                <h1
                  className={`text-xl font-semibold ${currentTheme.text} cursor-pointer`}
                  onClick={() => setShowMembersDialog(true)}
                  title="View members"
                >
                  {group.name}
                </h1>
                <p className={`text-sm ${currentTheme.text} opacity-70`}>You are: {userName || anonymousName} 😊</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-1"
                onClick={() => setShowMembersDialog(true)}
              >
                <Users className="w-4 h-4" />
                Members
              </Button>
            </div>
          </div>
          <div className="flex gap-2 items-center relative">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLeaveGroup}
              className="flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Leave Channel</span>
            </Button>
            <Dialog open={showBlockedUsersDialog} onOpenChange={setShowBlockedUsersDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Ban className="w-4 h-4" />
                  <span>Blocked ({blockedUsersList.length})</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Blocked Users</DialogTitle>
                  <DialogDescription>
                    Manage users you have blocked in this channel
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {blockedUsersList.length === 0 ? (
                    <p className="text-center text-muted-foreground py-4">
                      No users are blocked
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {blockedUsersList.map((blockedUser) => (
                        <div
                          key={blockedUser.userId}
                          className="flex items-center justify-between p-3 border border-border rounded-lg"
                        >
                          <div>
                            <p className="font-medium text-foreground">
                              {blockedUser.anonymousName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {`User ID: ${blockedUser.userId.substring(blockedUser.userId.length - 8)}`}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              handleUnblockUser(blockedUser.userId);
                              setShowBlockedUsersDialog(false);
                            }}
                            className="flex items-center gap-2"
                          >
                            <Ban className="w-4 h-4" />
                            Unblock
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Flag className="w-4 h-4" />
                  <span>Report</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Report User</DialogTitle>
                  <DialogDescription>
                    Report a user for inappropriate behavior in this group
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="report-user-select">Select User to Report</Label>
                    <select
                      id="report-user-select"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={reportUserId || ''}
                      onChange={(e) => setReportUserId(e.target.value)}
                    >
                      <option value="">Select a user...</option>
                      {allUsersInGroup
                        .filter((u) => u.userId && u.userId.toString() !== user?.id)
                        .map((userItem) => (
                          <option key={userItem.userId} value={userItem.userId}>
                            {userItem.anonymousName}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reason">Reason *</Label>
                    <Input
                      id="reason"
                      placeholder="e.g., Harassment, Spam, Inappropriate content"
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description (Optional)</Label>
                    <Textarea
                      id="description"
                      placeholder="Provide more details..."
                      value={reportDescription}
                      onChange={(e) => setReportDescription(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowReportDialog(false);
                        setReportUserId(null);
                        setReportReason('');
                        setReportDescription('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleReportUser}>
                      Submit Report
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={showThemeDialog} onOpenChange={setShowThemeDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    <span>Theme</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Channel Theme</DialogTitle>
                    <DialogDescription>
                      Choose a theme for this channel
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="grid grid-cols-4 gap-3">
                      {['default', 'blue', 'green', 'purple', 'orange', 'red', 'pink', 'grey'].map((theme) => (
                        <button
                          key={theme}
                          onClick={() => setSelectedTheme(theme)}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            selectedTheme === theme
                              ? 'border-primary ring-2 ring-primary ring-offset-2'
                              : 'border-border hover:border-primary/50'
                          }`}
                          style={{
                            backgroundColor: theme === 'default' ? 'hsl(var(--background))' :
                                          theme === 'blue' ? '#3b82f6' :
                                          theme === 'green' ? '#10b981' :
                                          theme === 'purple' ? '#8b5cf6' :
                                          theme === 'orange' ? '#f97316' :
                                          theme === 'red' ? '#ef4444' :
                                          theme === 'pink' ? '#ec4899' :
                                          theme === 'grey' ? '#6b7280' : 'transparent',
                            color: '#fff'
                          }}
                        >
                          <div className="text-xs font-medium capitalize">{theme}</div>
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowThemeDialog(false);
                          setSelectedTheme(groupTheme);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleThemeChange}>
                        Apply Theme
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            <Dialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Members</DialogTitle>
                  <DialogDescription>Current members</DialogDescription>
                </DialogHeader>
                <div className="max-h-[420px] overflow-y-auto space-y-2">
                  {membersList.length === 0 ? (
                    <p className="text-muted-foreground">No members yet.</p>
                  ) : (
                    membersList.map((member, idx) => {
                      const name = member.name || member.anonymousName;
                      const presence = presenceMap.get(member.userId || '') || { isOnline: false, lastActive: null };
                      return (
                        <div
                          key={`${member.userId || member.anonymousName}-${idx}`}
                          className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                        >
                          <div>
                            <p className="font-medium flex items-center gap-2">
                              <span
                                className={`inline-block h-2.5 w-2.5 rounded-full ${presence.isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
                              />
                              {name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {presence.isOnline ? 'Online' : formatLastSeen(presence.lastActive as string | null)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages
            .filter((message) => {
              const senderId = message.senderId || message.userId;
              if (!senderId) return true;
              if (blockedUsers.has(senderId)) return false;
              if (usersWhoBlockedMe.has(senderId)) return false;
              return true;
            })
            .map((message) => {
              const senderId = message.senderId || message.userId;
      const currentUserId = user?.id;
      const isCurrentUser = senderId === currentUserId;
      const messageUser = getUserFromMessage(message.anonymousName, senderId);
      const messageUserId = senderId || messageUser?.userId?.toString() || null;
      const isBlocked = messageUserId ? blockedUsers.has(messageUserId) : false;
              const formattedTime = new Date(message.createdAt).toLocaleTimeString();
              const displayName = message.senderName || message.anonymousName || (isCurrentUser ? 'You' : 'Unknown');

              return (
                <div
                  key={message._id}
                  id={`message-${message._id}`}
                  className={`message-row ${isCurrentUser ? 'right' : 'left'} flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`message-bubble ${isCurrentUser ? 'bubble-right' : 'bubble-left'} max-w-[70%]`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="sender-name">
                        {displayName}{' '}
                        {message.edited && <span className="text-xs opacity-70">(edited)</span>}
                      </div>
                      {isCurrentUser && !message.isDeleted && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
                              <MoreVertical className="w-3 h-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-36 p-2 space-y-1">
                            {!message.isFile && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start"
                                onClick={() => handleStartEdit(message)}
                              >
                                <Edit3 className="w-4 h-4 mr-2" />
                                Edit
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start text-destructive"
                              onClick={() => handleDeleteMessage(message._id)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </Button>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>

                    {editingMessageId === message._id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          rows={3}
                        />
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={handleSaveEdit}>
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : message.isDeleted ? (
                      <div className="text-sm italic text-muted-foreground">This message was deleted.</div>
                    ) : message.isFile ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <p className="text-sm font-medium">{message.fileName}</p>
                            <p className="text-xs opacity-70">
                              {(message.fileSize || 0) > 1024 ? `${(message.fileSize! / 1024).toFixed(2)} KB` : `${message.fileSize} bytes`}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => handleDownloadFile(message)} className="flex items-center gap-1">
                            <Download className="w-4 h-4" />
                            Download
                          </Button>
                        </div>
                        <div className="mt-2 p-2 bg-background/50 rounded text-xs font-mono max-h-32 overflow-y-auto">
                          <pre className="whitespace-pre-wrap break-words">{message.fileContent}</pre>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm break-words">
                        {message.content}
                      </div>
                    )}
                    <div className="text-[10px] opacity-70 mt-1 text-right">{formattedTime}</div>
                    {message.autoDelete?.enabled && isCurrentUser && (
                      <div className="mt-1">
                        <AutoDeleteTimer expiresAt={message.autoDelete.expiresAt} messageId={message._id} />
                      </div>
                    )}
                    {!isCurrentUser && messageUserId && (
                      <div className="mt-1">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <Ban className="w-3 h-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-2">
                            <div className="space-y-1">
                              {isBlocked ? (
                                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => handleUnblockUser(messageUserId)}>
                                  <Ban className="w-4 h-4 mr-2" />
                                  Unblock
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => handleBlockUser(messageUserId)}>
                                  <Ban className="w-4 h-4 mr-2" />
                                  Block
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setReportUserId(messageUserId); setShowReportDialog(true); }}>
                                <Flag className="w-4 h-4 mr-2" />
                                Report
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          {messages.length === 0 && (
            <div className={`text-center ${currentTheme.text} opacity-70 py-8`}>
              No messages yet. Start the conversation!
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </ScrollArea>

      <div className={`border-t ${currentTheme.border} p-4`}>
        <form
          onSubmit={handleSendMessage}
          className="max-w-4xl mx-auto flex gap-2 items-center"
        >
          <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
            <PopoverTrigger asChild>
              <Button type="button" size="icon" variant="ghost">
                <Smile className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0 border-0" side="top">
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                width={350}
                height={400}
              />
            </PopoverContent>
          </Popover>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.xml,text/*"
            onChange={handleFileUpload}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload">
            <Button type="button" size="icon" variant="ghost" asChild>
              <span>
                <Upload className="w-5 h-5" />
              </span>
            </Button>
          </label>
          <Popover open={showAutoDeleteMenu} onOpenChange={setShowAutoDeleteMenu}>
            <PopoverTrigger asChild>
              <Button 
                type="button" 
                size="icon" 
                variant={autoDeleteEnabled ? "default" : "ghost"}
                className={autoDeleteEnabled ? "bg-orange-500 hover:bg-orange-600" : ""}
              >
                <Clock className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" side="top">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-delete-toggle" className="text-sm font-medium">
                    Auto-delete message
                  </Label>
                  <input
                    type="checkbox"
                    id="auto-delete-toggle"
                    checked={autoDeleteEnabled}
                    onChange={(e) => setAutoDeleteEnabled(e.target.checked)}
                    className="rounded"
                  />
                </div>
                {autoDeleteEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor="auto-delete-time" className="text-xs text-muted-foreground">
                      Delete after
                    </Label>
                    <select
                      id="auto-delete-time"
                      value={autoDeleteTime}
                      onChange={(e) => setAutoDeleteTime(Number(e.target.value))}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value={30}>30 seconds</option>
                      <option value={60}>1 minute</option>
                      <option value={300}>5 minutes</option>
                      <option value={600}>10 minutes</option>
                      <option value={1800}>30 minutes</option>
                      <option value={3600}>1 hour</option>
                      <option value={86400}>24 hours</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Message will be deleted after {autoDeleteTime} seconds
                    </p>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Input
            ref={inputRef}
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" size="icon">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>

      <style jsx global>{`
        .message-row {
          display: flex;
          margin: 8px 0;
        }
        .message-row.left {
          justify-content: flex-start;
        }
        .message-row.right {
          justify-content: flex-end;
        }
        .message-bubble {
          border-radius: 12px;
          padding: 10px 12px;
          max-width: 70%;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
        }
        .bubble-left {
          background: #ffffff;
          color: #111827;
        }
        .bubble-right {
          background: #d9fdd3;
          color: #111827;
        }
        .sender-name {
          font-size: 0.8rem;
          font-weight: 600;
          margin-bottom: 4px;
        }
      `}</style>
    </div>
  );
}
