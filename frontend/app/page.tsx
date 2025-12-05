'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Login from '@/components/Login';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/groups');
    }
  }, [user, loading, router]);

  if (loading) {
    return <div className="container">Loading...</div>;
  }

  if (!user) {
    return <Login />;
  }

  return <div className="container">Redirecting...</div>;
}

