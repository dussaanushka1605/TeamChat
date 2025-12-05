'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { getSocket, initSocket } from '@/lib/socket';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LogOut, Users, Target, Plus } from 'lucide-react';
import { toast } from 'sonner';

interface Group {
  _id: string;
  name: string;
  code: string;
  description: string;
  userAnonymousName?: string;
  members: Array<{ anonymousName: string }>;
}

interface Announcement {
  _id: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  createdAt: string;
}

export default function GroupsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
      return;
    }
    if (user) {
      fetchGroups();
      fetchAnnouncements();
      setupSocket();
    }
    
    return () => {
      // Cleanup socket listeners on unmount
      const socket = getSocket();
      if (socket) {
        socket.off('newAnnouncement');
        socket.off('announcementRemoved');
        socket.off('channelUpdated');
      }
    };
  }, [user, loading, router]);

  const setupSocket = () => {
    const token = sessionStorage.getItem('token');
    if (!token) return;

    let socket = getSocket();
    if (!socket || !socket.connected) {
      socket = initSocket(token);
    }

    // Listen for new announcements
    socket.off('newAnnouncement');
    socket.on('newAnnouncement', (announcementData: Announcement) => {
      setAnnouncements((prev) => {
        const exists = prev.some(a => a.groupId === announcementData.groupId);
        if (exists) {
          return prev.map(a => a.groupId === announcementData.groupId ? { ...a, ...announcementData } : a);
        }
        return [announcementData, ...prev];
      });
    });

    // Listen for announcement removal
    socket.off('announcementRemoved');
    socket.on('announcementRemoved', () => {
      // Keep announcements in sync with backend without removing locally
      fetchAnnouncements();
    });

    // Listen for channel updates (membership count, etc.)
    socket.off('channelUpdated');
    socket.on('channelUpdated', () => {
      fetchAnnouncements();
      fetchGroups();
    });
  };

  const fetchGroups = async () => {
    try {
      const response = await api.get('/groups/all');
      setGroups(response.data.groups || []);
    } catch (err: any) {
      console.error('Error fetching channels:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to fetch channels';
      toast.error(errorMessage);
      // Set empty array on error to prevent UI issues
      setGroups([]);
    }
  };

  const fetchAnnouncements = async () => {
    try {
      const response = await api.get('/announcements/all');
      setAnnouncements(response.data.announcements || []);
    } catch (err: any) {
      console.error('Failed to fetch announcements:', err);
    }
  };

  const handleJoinFromAnnouncement = async (groupId: string, groupName: string, groupCode: string) => {
    try {
      const response = await api.post('/groups/join', { groupId });
      toast.success(`Joined ${groupName} successfully!`);
      // Refresh groups to get updated member counts
      await fetchGroups();
      await fetchAnnouncements(); // Keep announcements in sync (do not hide)
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to join channel');
    }
  };

  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinDialogOpen(false);

    try {
      const response = await api.post('/groups/join', { code: joinCode });
      toast.success('Successfully joined channel!');
      setJoinCode('');
      // Refresh groups to get updated member counts
      await fetchGroups();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to join channel');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await api.post('/groups/create', {
        name: groupName,
        description: groupDescription,
      });
      toast.success(`Channel created! Code: ${response.data.group.code}`);
      setGroupName('');
      setGroupDescription('');
      setCreateDialogOpen(false);
      // Refresh groups to get updated data
      await fetchGroups();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to create channel');
    }
  };

  const handleSignOut = () => {
    logout();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Create and manage channels</p>
          </div>
          <div className="flex gap-2 items-center">
            <ThemeToggle />
            <Button onClick={handleSignOut} variant="outline">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3 mb-8">
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="h-24">
                <Plus className="w-5 h-5 mr-2" />
                Create New Channel
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Channel</DialogTitle>
                <DialogDescription>
                  Create a new anonymous chat channel
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateGroup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="group-name">Channel Name</Label>
                  <Input
                    id="group-name"
                    placeholder="My Channel"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="group-description">Description (optional)</Label>
                  <Input
                    id="group-description"
                    placeholder="Channel description"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full">
                  Create Channel
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
            <DialogTrigger asChild>
              <Card className="cursor-pointer hover:border-accent transition-colors">
                <CardContent className="flex items-center justify-center h-24 p-6">
                  <Users className="w-5 h-5 mr-2" />
                  <span className="text-lg font-medium">Join Channel</span>
                </CardContent>
              </Card>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join Channel</DialogTitle>
                <DialogDescription>
                  Enter the channel code to join
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleJoinGroup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="join-code">Channel Code</Label>
                  <Input
                    id="join-code"
                    placeholder="ABC123"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    required
                  />
                </div>
                <Button type="submit" className="w-full">
                  Join Channel
                </Button>
              </form>
            </DialogContent>
          </Dialog>

        </div>

        {/* Announcements Section */}
        {announcements.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <span>📢</span> Announcements
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {announcements.map((announcement) => (
                <Card key={announcement._id} className="border-accent/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-pink-500" />
                      {announcement.groupName}
                    </CardTitle>
                    <CardDescription>
                      Channel Code: <span className="font-mono text-lg font-bold text-accent">{announcement.groupCode}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Posted {new Date(announcement.createdAt).toLocaleDateString()} at {new Date(announcement.createdAt).toLocaleTimeString()}
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => handleJoinFromAnnouncement(announcement.groupId, announcement.groupName, announcement.groupCode)}
                    >
                      Join Channel
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-4">My Channels</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <Card
                key={group._id}
                className="cursor-pointer hover:border-accent transition-colors"
                onClick={() => router.push(`/groups/${group._id}`)}
              >
                <CardHeader>
                  <CardTitle>{group.name}</CardTitle>
                  <CardDescription>
                    {group.memberCount || group.members?.length || 0} {group.memberCount === 1 || (group.members?.length === 1) ? 'member' : 'members'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/groups/${group._id}`);
                    }}
                  >
                    Open Chat
                  </Button>
                </CardContent>
              </Card>
            ))}
            {groups.length === 0 && (
              <p className="text-muted-foreground col-span-full text-center py-8">
                You haven't joined any channels yet
              </p>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
