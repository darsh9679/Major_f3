import { redirect } from "next/navigation";
import VoiceEnrollment from "@/components/VoiceEnrollment";
import { getCurrentUser } from "@/lib/actions/auth.action";

interface VoiceEnrollPageProps {
  searchParams: Promise<{ returnUrl?: string }>;
}

export default async function VoiceEnrollPage({ searchParams }: VoiceEnrollPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const returnUrl = params.returnUrl || "/";
  
  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="container mx-auto p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Voice Enrollment</h1>
        <p className="text-gray-600">
          Please enroll your voice to enable voice verification during interviews. 
          This helps ensure that you are the one participating in the interview.
        </p>
      </div>
      
      <VoiceEnrollment userId={user.id} returnUrl={returnUrl} />
    </div>
  );
}
