"use client";

import { Button } from "@/components/ui/button"
import { ArrowDown } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useSession } from "next-auth/react"
import { signIn } from "next-auth/react"
import { GitHubRepoDialog } from "./github-repo-dialog"

const AddRepo = () => {
  const { data: session } = useSession()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // User is connected if they have an active session
  const isGitHubConnected = !!session?.user

  const handleClick = () => {
    setIsDialogOpen(true)
  }

  const handleConnect = async () => {
    await signIn("github", { 
      callbackUrl: "/dashboard",
      redirect: true 
    })
  }

  return (
    <>
      <div
        onClick={handleClick}
        className="group px-6 py-6 flex flex-row justify-between items-center border rounded-lg bg-muted cursor-pointer 
        transition-all duration-300 ease-in-out
        hover:bg-background hover:border-[#E93F3F] hover:scale-[1.02]
        shadow-[0_2px_10px_rgba(0,0,0,0.08)]
        hover:shadow-[0_10px_30px_rgba(233,63,63,0.15)]"
      >
        <div className="flex flex-row justify-center items-start gap-4">
          <Button
            variant={"outline"}
            className="flex justify-center items-center bg-white group-hover:bg-[#fff8f8] group-hover:border-[#E93F3F] group-hover:text-[#E93F3F] transition-colors duration-300"
            size={"icon"}
          >
            <ArrowDown size={30} className="transition-transform duration-300 group-hover:translate-y-1" />
          </Button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-[#e93f3f]">Open Github Repository</h1>
            <p className="text-sm text-muted-foreground max-w-[220px]">Work with your repositories in our editor</p>
          </div>
        </div>

        <div className="relative overflow-hidden">
          <Image
            src={"/github.svg"}
            alt="Open GitHub repository"
            width={150}
            height={150}
            unoptimized
            className="transition-transform duration-300 group-hover:scale-110"
          />
        </div>
      </div>

      <GitHubRepoDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        isConnected={isGitHubConnected}
        onConnect={handleConnect}
      />
    </>
  )
}

export default AddRepo
