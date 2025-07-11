"use client";
import { useEffect, useState } from "react";
import "../globals.css"; // For a file in the same directory
import Sidebar from "./components/Sidebar";
import ContentArea from "./components/ContentArea";

export default function Dashboard() {
  const [allCampaignData, setAllCampaignData] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch data or load from localStorage
  const fetchData = async () => {
    setLoading(true); // Set loading to true when fetching starts
    const storedData = localStorage.getItem("campaignData");
    if (storedData) {
      setAllCampaignData(JSON.parse(storedData));
      setLoading(false);
    } else {
      try {
        const response = await fetch("/api", {
          next: {
            revalidate: 3600, // 1 hour
          },
        });
        if (!response.ok) {
          throw new Error("Failed to fetch data");
        }

        const data = await response.json();
        localStorage.setItem(
          "campaignData",
          JSON.stringify(data.validCampaignsData || [])
        );
        setAllCampaignData(data.validCampaignsData || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    // Add this to set 'lastUpdated' if it doesn't exist
    const storedLastUpdated = localStorage.getItem("lastUpdated");
    if (!storedLastUpdated) {
      const currentDate = new Date().toLocaleDateString();
      setLastUpdated(currentDate);
      localStorage.setItem("lastUpdated", currentDate); // Save in localStorage
    } else {
      setLastUpdated(storedLastUpdated); // Use the stored value if available
    }
  };

  // Call fetchData when the component mounts
  useEffect(() => {
    fetchData();
  }, []);

  // Handle customer selection and store it in localStorage
  useEffect(() => {
    if (selectedCustomer) {
      localStorage.setItem("selectedCustomer", selectedCustomer);
    }
  }, [selectedCustomer]);

  // Handle campaign selection and store it in localStorage
  useEffect(() => {
    if (selectedCampaign) {
      localStorage.setItem(
        "selectedCampaign",
        JSON.stringify(selectedCampaign)
      );
    }
  }, [selectedCampaign]);

  // Load selected customer and campaign from localStorage
  useEffect(() => {
    const storedCustomer = localStorage.getItem("selectedCustomer");
    const storedCampaign = localStorage.getItem("selectedCampaign");

    if (storedCustomer) {
      setSelectedCustomer(storedCustomer);
    }

    if (storedCampaign) {
      setSelectedCampaign(JSON.parse(storedCampaign));
    }
  }, []);

  const handleCustomerSelect = (customerName) => {
    setSelectedCustomer(customerName);
    setSelectedCampaign(null); // Reset campaign selection when customer changes
  };

  const handleCampaignSelect = (campaignId) => {
    // Flatten the campaigns and filter out undefined values
    const campaigns = allCampaignData
      .map((item) => item.campaigns)
      .flat()
      .filter((campaign) => campaign !== undefined); // Filter out undefined values

    // Find the selected campaign by its campaignId
    const selected = campaigns.find(
      (campaign) => campaign.campaignId === campaignId
    );
    if (selected) {
      setSelectedCampaign(selected);
    } else {
      console.log("No matching campaign found for the provided campaignId");
    }
  };

  // Refresh Data: Clear local storage and re-fetch data
  const refreshData = () => {
    console.log("Refreshing data...");

    // Clear local storage data related to campaigns
    localStorage.removeItem("campaignData");
    localStorage.removeItem("selectedCustomer");
    localStorage.removeItem("selectedCampaign");

    // Update the "Last Updated" date to the current date
    const currentDate = new Date().toLocaleDateString();
    setLastUpdated(currentDate);

    // Store the last updated date in localStorage
    localStorage.setItem("lastUpdated", currentDate);

    // Fetch new data
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-white">
        <h2 className="text-2xl text-customPurple mb-4">
          Pulling Data From Google....
        </h2>
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif"
          alt="Loading..."
          className="w-100 h-100"
        />
      </div>
    );
  }
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="flex flex-col sm:flex-row min-h-screen bg-customPurple-dark">
      {/* Sidebar: fixed width, scrollable if too tall */}
      <aside className="w-full sm:w-80 sm:min-w-[16rem] bg-customPurple-dark flex-shrink-0">
        <Sidebar
          customers={allCampaignData}
          selectedCustomer={selectedCustomer}
          handleCustomerSelect={handleCustomerSelect}
          handleCampaignSelect={handleCampaignSelect}
          selectedCampaign={selectedCampaign}
          lastUpdated={lastUpdated}
          refreshData={refreshData}
        />
      </aside>

      {/* Main content: grows to fill remaining space, prevents overflow */}
      <main className="flex-1 min-w-0 bg-gray-50 sm:rounded-t-2xl mt-4 sm:mt-8 p-4 sm:p-6 sm:mr-4">
        {selectedCustomer && (
          <ContentArea
            customerName={selectedCustomer}
            selectedCampaign={selectedCampaign}
            allCampaignData={allCampaignData}
            handleCampaignSelect={handleCampaignSelect}
          />
        )}
      </main>
    </div>
  );
}
